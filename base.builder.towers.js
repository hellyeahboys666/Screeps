'use strict';
// Pure: re-place PLANNED towers after the perimeter is known so the weakest
// perimeter rampart gets as much tower damage as possible (max-min). Built and
// queued towers stay where they are. Greedy seeding, then pair-swap sweeps
// (approach used by modern community planners: place towers after the cut).
const access = require('base.builder.access');
const STEPS = [-51, -50, -49, -1, 1, 49, 50, 51];
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function damage(r) { return r <= 5 ? 600 : r >= 20 ? 150 : 600 - (r - 5) * 30; }

// Hostile-reachable tiles: flood from open exits, blocked by terrain walls,
// sources/minerals/controller, our ramparts/constructed walls and the cut.
function outside(input, cutKeys, barrierKeys) {
    const blocked = new Uint8Array(2500);
    for (const o of input.sources.concat(input.minerals || [], [input.controller])) blocked[o.pos.y * 50 + o.pos.x] = 1;
    // Only the barriers the perimeter planner credited (near the base) count.
    for (const i of barrierKeys || []) blocked[i] = 1;
    for (const i of cutKeys) blocked[i] = 1;
    const seen = new Uint8Array(2500), queue = new Int32Array(2500);
    let h = 0, t = 0;
    for (let i = 0; i < 2500; i++) {
        const x = i % 50, y = (i - x) / 50;
        if ((x === 0 || x === 49 || y === 0 || y === 49) && !input.terrain[i] && !blocked[i]) { seen[i] = 1; queue[t++] = i; }
    }
    while (h < t) {
        const i = queue[h++], x = i % 50;
        for (const d of STEPS) {
            const n = i + d;
            if (n < 0 || n >= 2500 || Math.abs(n % 50 - x) > 1 || seen[n] || input.terrain[n] || blocked[n]) continue;
            seen[n] = 1; queue[t++] = n;
        }
    }
    return seen;
}

/** placeTowers(input, entries, cutKeys) -> {entries, moved, minDamage, before}
 * entries: the staged plan (without perimeter ramparts). Returns entries with the
 * planned towers' positions replaced, or the original entries when nothing helps. */
function placeTowers(input, entries, cutKeys, options) {
    options = options || {};
    const planned = entries.filter(e => e.type === 'tower');
    if (!planned.length || !cutKeys.length) return {entries, moved: 0};
    const fixed = input.structures.concat(input.sites).filter(o => o.type === 'tower').map(o => o.pos);
    const ramparts = cutKeys.map(i => ({x: i % 50, y: (i - i % 50) / 50}));
    const minOver = towers => {
        let min = Infinity, sum = 0;
        for (const r of ramparts) {
            let d = 0;
            for (const t of towers) d += damage(range(t, r));
            if (d < min) min = d;
            sum += d;
        }
        return {min, sum};
    };
    const before = minOver(fixed.concat(planned.map(e => e.pos)));
    const rest = entries.filter(e => e.type !== 'tower');
    const occupied = new Uint8Array(2500);
    for (const o of input.structures.concat(input.sites, input.sources, input.minerals || [], [input.controller], rest)) {
        occupied[o.pos.y * 50 + o.pos.x] = 1;
    }
    for (const i of cutKeys) occupied[i] = 1;
    const out = outside(input, cutKeys, options.barrierKeys), exitBand = access.nearExit(input);
    const hub = access.hubOf(input, rest);
    const walk = hub ? access.walkDistance(input, access.obstacles(input, rest), hub) : null;
    // Candidates: free tiles at least 4 from any hostile-reachable tile (a tower
    // keeps the full 3-tile buffer inside the wall), a short walk from storage.
    const candidates = [];
    for (let y = 2; y <= 47; y++) for (let x = 2; x <= 47; x++) {
        const i = y * 50 + x;
        if (input.terrain[i] || occupied[i] || exitBand[i] || (walk && walk[i] > 15)
            || (options.isLane && options.isLane(x, y))) continue;
        let safe = true;
        for (let ny = Math.max(0, y - 3); safe && ny <= Math.min(49, y + 3); ny++)
            for (let nx = Math.max(0, x - 3); nx <= Math.min(49, x + 3); nx++) if (out[ny * 50 + nx]) { safe = false; break; }
        if (safe) candidates.push({x, y});
    }
    if (!candidates.length) return {entries, moved: 0, before: before.min};
    // Damage table: candidate x rampart, plus the fixed towers' baseline.
    const R = ramparts.length, C = candidates.length;
    const table = new Int32Array(C * R), base = new Int32Array(R);
    for (let r = 0; r < R; r++) {
        for (const t of fixed) base[r] += damage(range(t, ramparts[r]));
        for (let c = 0; c < C; c++) table[c * R + r] = damage(range(candidates[c], ramparts[r]));
    }
    const guard = access.create(input);
    // Moving towers must not lengthen the fillers' walk to the extensions (e.g. by
    // blocking a tile next to the storage): allow at most +0.5 steps on average.
    const extensions = rest.filter(e => e.type === 'extension');
    const walkMean = towersAt => {
        if (!hub || !extensions.length) return 0;
        const dist = access.walkDistance(input, access.obstacles(input, rest.concat(towersAt)), hub);
        let total = 0;
        for (const e of extensions) {
            let best = 65535;
            for (const d of STEPS) { const i = e.pos.y * 50 + e.pos.x + d; if (i >= 0 && i < 2500 && dist[i] < best) best = dist[i]; }
            total += best;
        }
        return total / extensions.length;
    };
    const walkLimit = walkMean(planned) + 0.5;
    const accessible = chosen => {
        const placedTowers = chosen.map(c => ({type: 'tower', pos: candidates[c]}));
        return !guard.check(rest.concat(placedTowers)) && walkMean(placedTowers) <= walkLimit;
    };
    const score = chosen => {
        let min = Infinity, sum = 0;
        for (let r = 0; r < R; r++) {
            let d = base[r];
            for (const c of chosen) d += table[c * R + r];
            if (d < min) min = d;
            sum += d;
        }
        return min * 1e6 + sum;
    };
    const apart = (chosen, c) => chosen.every(o => range(candidates[o], candidates[c]) >= 2);
    let chosen = [];
    for (let k = 0; k < planned.length; k++) {
        const ranked = [];
        for (let c = 0; c < C; c++) if (!chosen.includes(c) && apart(chosen, c)) ranked.push({c, s: score(chosen.concat(c))});
        ranked.sort((a, b) => b.s - a.s);
        const pick = ranked.slice(0, 20).find(o => accessible(chosen.concat(o.c)));
        if (!pick) return {entries, moved: 0, before: before.min};
        chosen.push(pick.c);
    }
    let best = score(chosen);
    for (let sweep = 0; sweep < (options.sweeps || 2); sweep++) {
        let improved = false;
        for (let k = 0; k < chosen.length; k++) for (let c = 0; c < C; c++) {
            if (chosen.includes(c)) continue;
            const trial = chosen.slice(); trial[k] = c;
            if (!apart(trial.filter((_, j) => j !== k), c)) continue;
            const s = score(trial);
            if (s > best && accessible(trial)) { chosen = trial; best = s; improved = true; }
        }
        if (!improved) break;
    }
    const after = minOver(fixed.concat(chosen.map(c => candidates[c])));
    if (after.min < before.min || (after.min === before.min && after.sum <= before.sum)) {
        return {entries, moved: 0, before: before.min, minDamage: before.min};
    }
    let n = 0;
    const replaced = entries.map(e => e.type === 'tower'
        ? Object.assign({}, e, {pos: {x: candidates[chosen[n]].x, y: candidates[chosen[n++]].y}}) : e);
    return {entries: replaced, moved: planned.length, before: before.min, minDamage: after.min};
}
module.exports = {placeTowers, damage};
