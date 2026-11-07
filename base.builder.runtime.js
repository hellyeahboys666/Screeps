'use strict';
// Main-loop adapter: no planner modules are loaded until an explicit mode or
// auto-new-room enrollment is configured. Always called after hostile telemetry.
function modules() {
    return {
        manager: require('manager.baseBuilder'),
        survey: require('base.builder.survey'),
        compose: require('base.builder.compose'),
        core: require('base.builder.plan'),
        paths: require('base.builder.paths'),
        infrastructure: require('base.builder.infrastructure'),
        expansion: require('base.builder.expansion'),
        extensions: require('base.builder.extensions'),
        defense: require('base.builder.defense'),
        executor: require('base.builder.executor')
    };
}
function run(injected) {
    if (typeof Game === 'undefined' || !Game.rooms || typeof Memory === 'undefined') return [];
    var config = Memory.baseBuilder;
    if (config && config.disabled === true) return [];
    // Initialize even when no rooms are eligible; otherwise the first spawn
    // after activation would be accidentally baselined as an old room.
    if (config && config.autoNewRooms === true
        && !Number.isInteger(config.autoNewRoomsSince)) config.autoNewRoomsSince = Game.time;
    var names = Object.keys(Game.rooms).sort();
    var selected = names.filter(function(name) {
        var room = Game.rooms[name];
        return room && room.controller && room.controller.my === true
            && ((config && config.autoNewRooms === true)
                || (room.memory && room.memory.baseBuilder
                    && (room.memory.baseBuilder.mode === 'observe'
                        || room.memory.baseBuilder.mode === 'place')));
    });
    if (!selected.length) return [];
    var deps = injected || modules(), responses = [];
    for (var name of selected) {
        var room = Game.rooms[name];
        if (room.memory && room.memory.baseBuilder
            && room.memory.baseBuilder.runtimeBackoffUntil > Game.time) continue;
        try {
            var result = deps.manager.run(room, deps);
            responses.push({room: name, status: result.status});
        } catch (error) {
            if (room.memory) {
                var state = room.memory.baseBuilder || (room.memory.baseBuilder = {});
                state.runtimeError = String(error && error.message || error).slice(0, 120);
                state.runtimeBackoffUntil = Game.time + 500;
            }
            responses.push({room: name, status: 'error'});
        }
    }
    return responses;
}
module.exports = {run: run};
