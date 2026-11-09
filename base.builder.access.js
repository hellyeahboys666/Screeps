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
function flood(input, blocked) {
    const seen = new Uint8Array(2500), queue = new Int16Array(2500);
    const roads = new Set(input.structures.filter(o => o.type === 'road').map(o => key(o.pos)));
    let head = 0, tail = 0;
    function visit(x, y) {
        if (x < 1 || x > 48 || y < 1 || y > 48) return;
        const i = y * 50 + x;
        if (seen[i] || (input.terrain[i] && !roads.has(i)) || blocked.has(i)) return;
        seen[i] = 1; queue[tail++] = i;
    }
    // The spawn is an obstacle, never a usable seat or a path through the base.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) visit(input.anchor.pos.x + dx, input.anchor.pos.y + dy);
    }
    while (head < tail) {
        const i = queue[head++], x = i % 50, y = Math.floor(i / 50);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx || dy) visit(x + dx, y + dy);
        }
    }
    return seen;
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
    const before = flood(input, obstacles(input, []));
    const workers = existing.filter(o => WORKERS.has(o.type) && seat(before, o.pos, 1));
    const contracts = [];
    const storage = existing.find(o => o.type === 'storage');
    for (const link of existing.filter(o => o.type === 'link' && o.my !== false)) {
        for (const source of input.sources) {
            if (seat(before, source.pos, 1, link.pos)) contracts.push({target: source.pos, radius: 1, link: link.pos});
        }
        if (seat(before, input.controller.pos, 3, link.pos)) contracts.push({target: input.controller.pos, radius: 3, link: link.pos});
        if (storage && seat(before, storage.pos, 1, link.pos)) contracts.push({target: storage.pos, radius: 1, link: link.pos});
    }
    function check(entries, reached) {
        reached = reached || flood(input, obstacles(input, entries));
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
module.exports = {create, obstacles, flood, seat, passable};
