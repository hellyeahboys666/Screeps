'use strict';
const access = require('base.builder.access');
// Optional, non-destructive RCL7/8 reservations. Actual per-RCL legality is
// checked from CONTROLLER_STRUCTURES by the executor on every placement tick.
const TARGETS = [
    {type:'container', count:5, priority:25, near:6},
    {type:'spawn', count:3, priority:82, near:8},
    {type:'tower', count:6, priority:78, near:14},
    {type:'factory', count:1, priority:120, near:9},
    {type:'powerSpawn', count:1, priority:130, near:9},
    {type:'observer', count:1, priority:140, near:12},
    {type:'nuker', count:1, priority:150, near:10},
    {type:'link', count:6, priority:80, near:10}
];
function valid(p) {return !!p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x>=0 && p.x<50 && p.y>=0 && p.y<50;}
function idx(p) {return p.y*50+p.x;}
function range(a,b) {return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));}

function planExpansion(input,seed) {
    const invalid={entries:[],blockers:['invalidExpansionInput']};
    if(!input||input.eligible!==true||!input.anchor||!valid(input.anchor.pos)
        ||!input.controller||!valid(input.controller.pos)
        ||!Array.isArray(input.terrain)||input.terrain.length!==2500
        ||!Array.isArray(seed)||!['structures','sites','sources','minerals'].every(k=>
            Array.isArray(input[k])&&input[k].every(o=>o&&valid(o.pos)))
        ||!seed.every(o=>o&&valid(o.pos)&&typeof o.type==='string'))return invalid;
    const all=input.structures.concat(input.sites,seed);
    const occupied=new Set(all.concat(input.sources,input.minerals,[input.controller])
        .map(o=>idx(o.pos)));
    const guard=access.create(input);
    const entries=[],blockers=[];
    const storage=all.find(o=>o.type==='storage');
    if(guard.check(seed))return {entries:[],blockers:['initialAccessBlocked']};
    for(const spec of TARGETS) {
        const existing=all.concat(entries).filter(o=>o.type===spec.type
            && (o.my!==false || spec.type==='container')).length;
        for(let ordinal=existing+1;ordinal<=spec.count;ordinal++) {
            const positions=[];
            const prior=all.concat(entries).filter(o=>o.type===spec.type).map(o=>o.pos);
            for(let y=2;y<=47;y++)for(let x=2;x<=47;x++) {
                const p={x,y}, key=idx(p), d=range(p,input.anchor.pos);
                if(input.terrain[key]||occupied.has(key)||d>spec.near
                    ||input.sources.some(s=>range(p,s.pos)<=2)
                    ||input.minerals.some(m=>range(p,m.pos)<=1)
                    ||range(p,input.controller.pos)<=3)continue;
                const fromStorage=storage?range(p,storage.pos):d;
                if((spec.type==='factory'||spec.type==='powerSpawn') && fromStorage>8)continue;
                if(spec.type==='spawn' && (d<3||fromStorage>10))continue;
                const separation=prior.length?Math.min(...prior.map(q=>range(p,q))):6;
                if(spec.type==='tower' && separation<3)continue;
                let score=d*3+fromStorage*2;
                if(spec.type==='tower')score-=Math.min(separation,9)*5;
                else if(spec.type==='spawn')score-=Math.min(separation,7)*3;
                else if(spec.type==='factory'||spec.type==='powerSpawn')score+=fromStorage*8;
                positions.push({p,score});
            }
            positions.sort((a,b)=>a.score-b.score||a.p.y-b.p.y||a.p.x-b.p.x);
            let selected;
            for(const choice of positions.slice(0,64)){
                if(!guard.check(seed.concat(entries,{type:spec.type,pos:choice.p}))){selected=choice.p;break;}
            }
            if(!selected){blockers.push('noAccessibleSpace:'+spec.type+':'+ordinal);break;}
            entries.push({type:spec.type,purpose:'expansion:'+spec.type+':'+ordinal,
                pos:selected,priority:spec.priority});
            occupied.add(idx(selected));
        }
    }
    return {entries,blockers};
}
module.exports={planExpansion};
