'use strict';
// Pure, shared eventual-layout checks. Existing inaccessible workers are not
// repaired or removed, but every currently usable worker/link contract is kept.
const WORKERS = new Set(['spawn', 'extension', 'storage', 'terminal', 'link', 'tower',
    'lab', 'factory', 'powerSpawn', 'observer', 'nuker', 'container', 'extractor']);
function key(p) { return p.y * 50 + p.x; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function passable(type) { return ['road', 'container', 'rampart', 'extractor'].includes(type); }
function obstacles(input, entries) {
    const blocked = new Set(input.structures.concat(input.sites, input.spawns || [], entries || [])
        .filter(o => !passable(o.type) || (o.type === 'rampart' && o.my === false))
        .map(o => key(o.pos)));
    for (const o of input.sources.concat(input.minerals || [], [input.controller, input.anchor])) blocked.add(key(o.pos));
    return blocked;
}
// Walkable terrain (plain/swamp, or a built road over a wall = tunnel) inside the
// 1..48 band, cached per snapshot. Floods run once per candidate tile, so they work
// on flat typed arrays: the 0/49 border stays closed, so the eight neighbour
// offsets below never wrap across a row.
const baseCache = new WeakMap();
const STEPS = [-51, -50, -49, -1, 1, 49, 50, 51];
function walkable(input) {
    let base = baseCache.get(input);
    if (!base) {
        base = new Uint8Array(2500);
        for (let y = 1; y <= 48; y++) for (let x = 1; x <= 48; x++) base[y * 50 + x] = input.terrain[y * 50 + x] ? 0 : 1;
        for (const o of input.structures) if (o.type === 'road') {
            const i = key(o.pos);
            if (o.pos.x >= 1 && o.pos.x <= 48 && o.pos.y >= 1 && o.pos.y <= 48) base[i] = 1;
        }
        baseCache.set(input, base);
    }
    return base;
}
function openMask(input, blocked) {
    const open = walkable(input).slice();
    for (const i of blocked) if (i >= 0 && i < 2500) open[i] = 0;
    return open;
}
// Tiles within EXIT_CLEARANCE of an open exit tile. Base structures stay out of
// this band so a perimeter (ramparts at 2..47) can still keep a 3-tile buffer
// between attackers and every structure. Cached per snapshot.
const EXIT_CLEARANCE = 5;
const exitCache = new WeakMap();
function nearExit(input) {
    let mask = exitCache.get(input);
    if (!mask) {
        mask = new Uint8Array(2500);
        for (let i = 0; i < 2500; i++) {
            const x = i % 50, y = (i - x) / 50;
            if (!(x === 0 || x === 49 || y === 0 || y === 49) || input.terrain[i]) continue;
            for (let ny = Math.max(0, y - EXIT_CLEARANCE); ny <= Math.min(49, y + EXIT_CLEARANCE); ny++)
                for (let nx = Math.max(0, x - EXIT_CLEARANCE); nx <= Math.min(49, x + EXIT_CLEARANCE); nx++) mask[ny * 50 + nx] = 1;
        }
        exitCache.set(input, mask);
    }
    return mask;
}
function hubOf(input, entries) {
    const bank = input.structures.concat(input.sites, entries || []).find(o => o && o.type === 'storage');
    return bank ? bank.pos : null;
}
// Walkable area of the base. The spawn is an obstacle, never a usable seat or a
// path: tiles around it may lie in separate pockets that only the spawn tile
// joins, and haulers cannot walk through a spawn. Each spawn-adjacent pocket is
// labelled separately; the base is the pocket next to the storage (the hauler
// hub) when there is one, otherwise the largest pocket.
function flood(input, blocked, hub) {
    const open = openMask(input, blocked), label = new Uint8Array(2500), queue = new Int16Array(2500);
    const nearHub = new Uint8Array(2500);
    if (hub) for (const d of STEPS) { const i = hub.y * 50 + hub.x + d; if (i >= 0 && i < 2500) nearHub[i] = 1; }
    const sizes = [0], touchesHub = [false];
    let head = 0, tail = 0;
    for (const d0 of STEPS) {
        const s = input.anchor.pos.y * 50 + input.anchor.pos.x + d0;
        if (s < 0 || s >= 2500 || !open[s] || label[s]) continue;
        const c = sizes.length; sizes.push(1); touchesHub.push(!!nearHub[s]);
        label[s] = c; queue[tail++] = s;
        while (head < tail) {
            const i = queue[head++];
            for (const d of STEPS) {
                const n = i + d;
                if (!open[n] || label[n]) continue;
                label[n] = c; queue[tail++] = n; sizes[c]++;
                if (nearHub[n]) touchesHub[c] = true;
            }
        }
    }
    let best = 0;
    for (let c = 1; c < sizes.length; c++) {
        const better = !best || (touchesHub[c] !== touchesHub[best] ? touchesHub[c] : sizes[c] > sizes[best]);
        if (better) best = c;
    }
    const seen = new Uint8Array(2500);
    if (best) for (let i = 0; i < 2500; i++) if (label[i] === best) seen[i] = 1;
    return seen;
}
// Walking steps from the tiles next to `from` (normally the storage), through
// tiles that are not blocked. 0 = standing next to it; 65535 = unreachable.
function walkDistance(input, blocked, from) {
    const open = openMask(input, blocked), dist = new Uint16Array(2500).fill(65535), queue = new Int16Array(2500);
    let head = 0, tail = 0;
    for (const d of STEPS) {
        const i = from.y * 50 + from.x + d;
        if (i >= 0 && i < 2500 && open[i] && dist[i] === 65535) { dist[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
        const i = queue[head++];
        for (const d of STEPS) {
            const n = i + d;
            if (!open[n] || dist[n] !== 65535) continue;
            dist[n] = dist[i] + 1; queue[tail++] = n;
        }
    }
    return dist;
}
function seat(reached, pos, radius, other) {
    for (let y = Math.max(1, pos.y - radius); y <= Math.min(48, pos.y + radius); y++)
        for (let x = Math.max(1, pos.x - radius); x <= Math.min(48, pos.x + radius); x++) {
            if (reached[y * 50 + x] && (!other || range({x, y}, other) === 1)) return true;
        }
    return false;
}
function create(input) {
    const existing = input.structures.concat(input.sites, input.spawns || []);
    const before = flood(input, obstacles(input, []), hubOf(input, []));
    const workers = existing.filter(o => WORKERS.has(o.type) && seat(before, o.pos, 1));
    const contracts = [];
    const storage = existing.find(o => o.type === 'storage');
    // Protect each existing link's one job, classified like the bot does (source
    // link first, then controller, then storage). Incidental shared seats with
    // other targets are not contracts; requiring them blocked unrelated sites.
    for (const link of existing.filter(o => o.type === 'link' && o.my !== false)) {
        const source = input.sources.find(s => seat(before, s.pos, 1, link.pos));
        if (source) contracts.push({target: source.pos, radius: 1, link: link.pos});
        else if (seat(before, input.controller.pos, 3, link.pos)) contracts.push({target: input.controller.pos, radius: 3, link: link.pos});
        else if (storage && seat(before, storage.pos, 1, link.pos)) contracts.push({target: storage.pos, radius: 1, link: link.pos});
    }
    function check(entries, reached) {
        reached = reached || flood(input, obstacles(input, entries), hubOf(input, entries));
        if (!input.sources.every(o => seat(reached, o.pos, 1))) return 'blockedSourceSeat';
        if (!seat(reached, input.controller.pos, 3)) return 'blockedControllerSeat';
        if (!(input.minerals || []).every(o => seat(reached, o.pos, 1))) return 'blockedMineralSeat';
        if (!workers.concat(entries.filter(o => WORKERS.has(o.type)))
            .every(o => seat(reached, o.pos, 1))) return 'blockedWorkerStructure';
        if (!contracts.every(c => seat(reached, c.target, c.radius, c.link))) return 'blockedExistingLinkSeat';
        const bank = storage || entries.find(o => o.type === 'storage');
        for (const link of entries.filter(o => o.type === 'link')) {
            let target, radius;
            if (String(link.purpose).startsWith('sourceLink:')) {
                const source = input.sources.find(o => link.purpose === 'sourceLink:' + o.id);
                target = source && source.pos; radius = 1;
            } else if (link.purpose === 'controllerLink') {
                target = input.controller.pos; radius = 3;
            } else if (link.purpose === 'baseLink') {
                target = bank && bank.pos; radius = 1;
            } else continue;
            if (!target || !seat(reached, target, radius, link.pos)) return 'blockedSharedLinkSeat:' + link.purpose;
        }
        return null;
    }
    return {check};
}
module.exports = {create, obstacles, flood, seat, passable, hubOf, walkDistance, nearExit};
