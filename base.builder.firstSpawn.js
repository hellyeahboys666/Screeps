'use strict';
// Read-only first-spawn candidate ranking. This module never issues game intents.
const SIZE = 50, CELLS = 2500, UNREACHABLE = 65535;
function idx(p) { return p.y * SIZE + p.x; }
function pos(i) { return {x: i % SIZE, y: Math.floor(i / SIZE)}; }
function valid(p) { return !!p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function walkable(type, my) { return type === 'road' || type === 'container'
    || (type === 'rampart' && my === true); }
function validSnapshot(input) {
    return input && input.eligible === true && typeof input.roomName === 'string'
        && input.controller && valid(input.controller.pos)
        && Array.isArray(input.terrain) && input.terrain.length === CELLS
        && input.terrain.every(t => t === 0 || t === 1)
        && ['sources', 'minerals', 'structures', 'sites', 'spawns'].every(k =>
            Array.isArray(input[k]) && input[k].every(o => o && valid(o.pos)))
        && input.sources.length > 0;
}
function clearance(terrain, blocked) {
    const distances = new Uint8Array(CELLS);
    for (let y = 1; y < 49; y++) for (let x = 1; x < 49; x++) {
        const i = y * SIZE + x;
        if (!terrain[i] && !blocked[i]) distances[i] = 49;
    }
    for (let y = 1; y < 49; y++) for (let x = 1; x < 49; x++) {
        const i = y * SIZE + x;
        if (distances[i]) distances[i] = Math.min(distances[i], 1 + distances[i - 1],
            1 + distances[i - SIZE], 1 + distances[i - SIZE - 1], 1 + distances[i - SIZE + 1]);
    }
    for (let y = 48; y >= 1; y--) for (let x = 48; x >= 1; x--) {
        const i = y * SIZE + x;
        if (distances[i]) distances[i] = Math.min(distances[i], 1 + distances[i + 1],
            1 + distances[i + SIZE], 1 + distances[i + SIZE - 1], 1 + distances[i + SIZE + 1]);
    }
    return distances;
}
function travelDistances(target, radius, input, blocked) {
    const distance = new Uint16Array(CELLS), queue = new Uint16Array(CELLS);
    distance.fill(UNREACHABLE);
    let head = 0, tail = 0;
    for (let y = Math.max(1, target.y - radius); y <= Math.min(48, target.y + radius); y++)
        for (let x = Math.max(1, target.x - radius); x <= Math.min(48, target.x + radius); x++) {
            if (range({x, y}, target) < 1) continue;
            const i = y * SIZE + x;
            if (input.terrain[i] || blocked[i]) continue;
            distance[i] = 0;
            queue[tail++] = i;
        }
    while (head < tail) {
        const i = queue[head++], p = pos(i);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const x = p.x + dx, y = p.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            const n = y * SIZE + x;
            if (input.terrain[n] || blocked[n] || distance[n] !== UNREACHABLE) continue;
            distance[n] = distance[i] + 1;
            queue[tail++] = n;
        }
    }
    return distance;
}
function rankCandidates(input, limit) {
    if (!validSnapshot(input)) return {candidates: [], blockers: ['invalidSnapshot']};
    if (input.spawns.length) return {candidates: [], blockers: ['alreadySpawned']};
    if (input.sites.some(s => s.type === 'spawn')) return {candidates: [], blockers: ['existingSpawnSite']};
    const blocked = new Uint8Array(CELLS), occupied = new Uint8Array(CELLS);
    for (const o of input.structures.concat(input.sites, input.sources,
        input.minerals, [input.controller])) {
        occupied[idx(o.pos)] = 1;
        if (!walkable(o.type, o.my)) blocked[idx(o.pos)] = 1;
    }
    const clear = clearance(input.terrain, blocked);
    const sourceMaps = input.sources.map(s => travelDistances(s.pos, 1, input, blocked));
    const controllerMap = travelDistances(input.controller.pos, 3, input, blocked);
    const max = Number.isInteger(limit) ? Math.max(1, Math.min(128, limit)) : 64;
    const candidates = [];
    for (let y = 2; y <= 47; y++) for (let x = 2; x <= 47; x++) {
        const p = {x, y}, i = idx(p);
        if (input.terrain[i] || occupied[i] || clear[i] === 0
            || range(p, input.controller.pos) <= 3
            || input.sources.some(s => range(p, s.pos) <= 2)
            || input.minerals.some(m => range(p, m.pos) <= 1)) continue;
        const controllerDistance = controllerMap[i], sourceDistances = sourceMaps.map(m => m[i]);
        if (controllerDistance === UNREACHABLE || sourceDistances.some(d => d === UNREACHABLE)) continue;
        let open = 0;
        for (let yy = Math.max(2, y - 3); yy <= Math.min(47, y + 3); yy++)
            for (let xx = Math.max(2, x - 3); xx <= Math.min(47, x + 3); xx++)
                if (!input.terrain[yy * SIZE + xx] && !occupied[yy * SIZE + xx]) open++;
        const exitDistance = Math.min(x, y, 49 - x, 49 - y);
        const score = 4 * controllerDistance + 3 * sourceDistances.reduce((a, b) => a + b, 0)
            + 2 * Math.max(...sourceDistances) + (49 - open)
            + 12 * Math.max(0, 5 - clear[i]) + 8 * Math.max(0, 9 - exitDistance);
        candidates.push({pos: p, score});
    }
    candidates.sort((a, b) => a.score - b.score || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    if (!candidates.length) return {candidates: [], blockers: ['noReachableSpawnTile']};
    return {candidates: candidates.slice(0, max), blockers: []};
}
function evaluateCandidate(input, candidate, deps) {
    const p = candidate && candidate.pos;
    if (!validSnapshot(input) || !p || !valid(p) || p.x < 2 || p.x > 47
        || p.y < 2 || p.y > 47 || !Number.isFinite(candidate.score)
        || input.spawns.length || input.sites.some(s => s.type === 'spawn')
        || input.terrain[idx(p)]
        || input.structures.concat(input.sites).some(o => idx(o.pos) === idx(p))
        || !deps || !deps.core || !deps.compose) {
        return {valid: false, blockers: ['invalidCandidate']};
    }
    const pretend = {id: 'plannedFirstSpawn:' + input.roomName, type: 'spawn', my: true,
        pos: {x: p.x, y: p.y}};
    // Temporary simulation only: the built-spawn manager later surveys the real room.
    const simulated = Object.assign({}, input, {anchor: pretend, spawns: [pretend],
        structures: input.structures.concat([pretend])});
    const proposal = deps.compose.compose(simulated, deps, {perimeter: false, extensionLimit: 60});
    if (!proposal.valid) return {valid: false, blockers: proposal.blockers};
    const extensionCount = proposal.entries.filter(e => e.type === 'extension').length
        + input.structures.concat(input.sites).filter(o => o.type === 'extension' && o.my).length;
    if (extensionCount < 5) return {valid: false, blockers: ['insufficientExtensionCapacity']};
    const roadCount = proposal.entries.filter(e => e.type === 'road').length;
    return {valid: true, pos: pretend.pos, score: candidate.score
        + 15 * (60 - extensionCount) + roadCount + 3 * proposal.warnings.length,
        extensionCount, warnings: proposal.warnings};
}
module.exports = {rankCandidates, evaluateCandidate};
