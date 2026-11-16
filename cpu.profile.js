'use strict';
// Checkpoint CPU profiler for the main loop. mark(label) charges the CPU used since
// the previous mark to `label`, so early `continue`s in a loop never lose time (it
// lands on the next mark instead). Totals live in the heap and are summarised into
// Memory.cpuProfile every WINDOW ticks as average CPU per tick, largest first.
// Off: Memory.cpuProfileEnabled = false (marks then cost one comparison).
var WINDOW = 100;
var TOP = 40;

var acc = null, last = 0, on = false;

function start()
{
    // Do not touch Memory here: the first read parses it, and that cost belongs to
    // the 'memoryParse' mark right after the loop's first Memory access.
    on = typeof Game != 'undefined' && !!Game.cpu && typeof Game.cpu.getUsed == 'function';
    if (!on) return;
    if (!acc || Game.time < acc.from || Game.time - acc.from >= WINDOW) acc = {from: Game.time, ticks: 0, sections: {}, max: 0};
    acc.ticks++;
    last = Game.cpu.getUsed();
}

function mark(label)
{
    if (!on) return;
    var now = Game.cpu.getUsed();
    var s = acc.sections[label] || (acc.sections[label] = {cpu: 0, n: 0, max: 0});
    var used = now - last;
    s.cpu += used;
    s.n++;
    if (used > s.max) s.max = used;
    last = now;
}

function end()
{
    if (!on) return;
    if (Memory.cpuProfileEnabled === false) { acc = null; on = false; return; }
    var total = Game.cpu.getUsed();
    acc.total = (acc.total || 0) + total;
    if (total > acc.max) acc.max = total;
    if (Game.time - acc.from + 1 >= WINDOW) flush();
}

function round(x) { return Math.round(x * 1000) / 1000; }

function flush()
{
    var ticks = acc.ticks || 1, perTick = {}, calls = {};
    var labels = Object.keys(acc.sections).sort(function(a, b) { return acc.sections[b].cpu - acc.sections[a].cpu; });
    for (var label of labels.slice(0, TOP))
    {
        var s = acc.sections[label];
        perTick[label] = round(s.cpu / ticks);
        calls[label] = {n: round(s.n / ticks), max: round(s.max)};
    }
    Memory.cpuProfile = {from: acc.from, to: Game.time, ticks: ticks, bucket: Game.cpu.bucket,
        avgTotal: round(acc.total / ticks), maxTotal: round(acc.max), perTick: perTick, calls: calls};
    acc = null;
}

module.exports = {start: start, mark: mark, end: end, WINDOW: WINDOW};
