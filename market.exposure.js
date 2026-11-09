// Buy-order exposure committed earlier this tick. Game.market.credits and
// Game.market.orders don't change until the tick ends, so the combat boost,
// special structure and energy reserve modules (and each one's own later
// orders) must count what was just created, extended or repriced, or together
// they can size orders past the credit floor. Amounts include the 5% fee.
// All three modules share this one module instance.
var pending = {tick: -1, amount: 0};

function getPending()
{
    return pending.tick == Game.time ? pending.amount : 0;
}

function addPending(amount)
{
    if (!(amount > 0))
    {
        return;
    }
    if (pending.tick != Game.time)
    {
        pending = {tick: Game.time, amount: 0};
    }
    pending.amount += amount;
}

module.exports = {
    getPending: getPending,
    addPending: addPending
};
