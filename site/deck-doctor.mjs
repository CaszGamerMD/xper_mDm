/** Deck Doctor — objective-driven, minimal-change Commander repair.
 * Results are heuristic construction ratings, NOT observed win-rates, combo proofs,
 * or a guarantee of competitive strength. Every proposed addition is checked
 * against Scryfall legalities and full commander color identity.
 */
import {ScryfallSource,DeckInputError,withinIdentity,roleMatch,cardFromScryfall} from './generator.mjs';
import {parseDecklist} from './playtest.mjs';
import {cardNameKey,lookupNamedCard,resolveCardNames} from './card-lookup.mjs';
import {deckPlan,PLANS,THEME_SEARCHES,synergyFeatures,cohesionReport} from './synergy.mjs';
import {averageSpellManaValue} from './presentation.mjs';

const lower=s=>String(s||'').toLowerCase();
const norm=c=>lower(c.name).trim();
const isLand=c=>Boolean(c.land??/\bLand\b/.test((c.type_line||c.type||'').split(' — ')[0].split(' // ')[0]));
const isCreature=c=>Boolean(c.creature??/\bCreature\b/.test(c.type_line||c.type||''));
const coerce=c=>({...c,type_line:c.type_line||c.type||'',oracle_text:c.oracle_text||'',
  keywords:c.keywords||[],cmc:Number(c.cmc)||0,color_identity:c.color_identity||[],
  land:isLand(c),creature:isCreature(c),basic:Boolean(c.basic??/\bBasic Land\b/.test(c.type_line||c.type||'')),
  eligible:c.eligible!==false});
const duplicateAllowed=c=>c.basic || /\ba deck can have (?:any number|up to)\b/i.test(c.oracle_text||'');
const withColors=c=>[...(c.color_identity||[])].sort().join('');
const cap=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const neededCount=(n,t)=>cap(n/t);
const SPREAD=['wipe','ramp','draw','removal','protection','finisher'];
const NEED={ramp:10,draw:10,removal:8,protection:4,wipe:3,finisher:4};
const WEIGHTS={ramp:9,draw:9,removal:9,protection:5,wipe:4,finisher:4};
const ROLE_NAMES={ramp:'Ramp',draw:'Card draw',removal:'Interaction',protection:'Protection',wipe:'Board wipes',finisher:'Finishers',synergy:'Engine'};
function role(c){
  if(isLand(c))return 'land';
  for(const key of SPREAD) if(roleMatch(c,key))return key;
  return 'synergy';
}
const COMMON_TRIBES=['Frog','Elf','Goblin','Zombie','Vampire','Human','Wizard','Dragon','Dinosaur','Cat','Dog','Angel','Demon','Merfolk','Faerie','Squirrel','Rat','Rabbit','Sliver','Spirit','Elemental','Bird','Fish','Mouse','Warrior','Cleric','Knight','Artifact Creature','Soldier','Shaman','Insect','Saproling','Warlock'];
export function inferTribes(cards,commander){
  const creatures=cards.filter(isCreature);
  const matches=COMMON_TRIBES.filter(t=>t!=='Artifact Creature').map(t=>{
    const re=new RegExp('\\b'+t+'\\b','i');
    const n=creatures.filter(c=>re.test((c.type_line||'').split(' // ')[0])).length;
    const cmd=new RegExp('\\b'+t+'s?\\b','i').test(commander.oracle_text||'');
    return {t,n,cmd};
  }).sort((a,b)=>b.n-a.n);
  return matches.filter(t=>t.n>=5 && t.n/Math.max(1,creatures.length)>=.25).slice(0,2).map(x=>x.t);
}
export function inferPlan(cards,commander){
  const spells=cards.filter(c=>!isLand(c));
  const commanderPreference=deckPlan([],commander);
  const candidates=Object.keys(PLANS).filter(k=>!k.includes('1/1'));
  const ranking=candidates.map(plan=>{
    const facts=spells.map(c=>synergyFeatures(c,plan,[],commander));
    const enablers=facts.filter(f=>f.enabler).length;
    const payoffs=facts.filter(f=>f.payoff).length;
    const score=Math.min(enablers,13)*.75+Math.min(payoffs,10)*1.35+
      Math.min(facts.filter(f=>f.enabler&&f.payoff).length,8)*.35+
      (commanderPreference===plan?3:0);
    return {plan,score,enablers,payoffs};
  }).filter(x=>x.enablers>=3&&x.payoffs>=2).sort((a,b)=>b.score-a.score);
  return ranking[0]?.plan || commanderPreference || null;
}
function commanderFit(commander,cards,plan,tribes,context=null){
  const oracle=lower(commander.oracle_text);
  const total=cards.filter(c=>!isLand(c)).length;
  const matched=cards.filter(c=>!isLand(c) && (context?factsFor(c,commander,context):synergyFeatures(c,plan,tribes,commander)).coherent).length;
  let score=0;
  for(const tribe of tribes){
    const re=new RegExp('\\b'+tribe.toLowerCase()+'s?\\b','i');
    if(re.test(oracle))score+=8;
  }
  const shape=PLANS[plan];
  if(shape) {
    if(shape.enabler.some(re=>re.test(oracle)))score+=6;
    if(shape.payoff.some(re=>re.test(oracle)))score+=6;
    if(oracle.includes(plan))score+=2;
  }
  if(!tribes.length&&!shape && /whenever|you control|each creature/.test(oracle))score+=3;
  // Commander is specifically a better fit only when existing cards support its text.
  const supportFraction=matched/Math.max(1,total);
  return Math.round(cap(score*(.45+.55*cap(supportFraction/.40)),0,20));
}

/** Color-demand and attainable mana sources, estimated from the printed cards.
 * Land sources are counted once per color they can produce. Any-color lands
 * count for each identity color; land-fetch effects count for matching typed basics.
 * This is a mana-base estimate, not a turn-by-turn mana probability simulator.
 */
export function manaBalance(cards,commander){
  const colors=(commander.color_identity||[]).filter(c=>'WUBRG'.includes(c));
  const spells=[commander,...cards.filter(c=>!isLand(c))];
  const lands=cards.filter(isLand);
  const demand=Object.fromEntries(colors.map(c=>[c,0]));
  const sources=Object.fromEntries(colors.map(c=>[c,0]));
  const basicTypes={W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest'};
  for(const spell of spells){
    const costs=String(spell.mana_cost||'').match(/\{[^}]+\}/g)||[];
    for(const symbol of costs){
      const inside=symbol.slice(1,-1);
      for(const c of colors)if(inside===c)demand[c]+=1;
      // Hybrid/P tokens are approximate and each color shares their demand.
      if(inside.includes('/'))for(const c of colors)if(inside.split('/').includes(c))demand[c]+=.5;
    }
  }
  for(const land of lands){
    const typ=String(land.type_line||land.type||'');
    const oracle=lower(land.oracle_text);
    const actual=new Set(land.produced_mana||[]);
    for(const [c,name] of Object.entries(basicTypes))if(new RegExp('\\b'+name+'\\b').test(typ))
      actual.add(c);
    if(/add (?:one|two|three) mana of any (?:one )?color|add one mana of any type/.test(oracle))
      colors.forEach(c=>actual.add(c));
    if(/search your library for .*land card/.test(oracle)){
      for(const [c,name] of Object.entries(basicTypes))
        if(oracle.includes(lower(name)))actual.add(c);
    }
    for(const color of colors)if(actual.has(color))sources[color]++;
  }
  const total=Math.max(1,Object.values(demand).reduce((a,b)=>a+b,0));
  const targets=Object.fromEntries(colors.map(c=>[c,
    Math.max(4,lands.length*.79*((demand[c]||.5)/total))]));
  const fractions=colors.map(c=>cap(sources[c]/targets[c]));
  const score=colors.length?fractions.reduce((a,b)=>a+b,0)/colors.length:1;
  return {colors,demand,sources,targets,score:Number(score.toFixed(3)),
    warnings:colors.filter(c=>sources[c]<targets[c]*.75).map(c=>
      c+': approximately '+sources[c]+' mana sources for '+demand[c].toFixed(1)+' colored symbols; target ~'+Math.ceil(targets[c])+' sources.')};
}


/** Cache immutable Oracle-text feature classification throughout a diagnosis.
 * The former search ran dozens of regex checks three times per card for
 * thousands of trial decks, blocking the browser on 20-swap requests.
 */
function factsFor(c,commander,context){
  if(!context._facts)context._facts=new Map();
  const key=norm(commander)+'|'+norm(c);
  if(!context._facts.has(key))
    context._facts.set(key,synergyFeatures(c,context.plan,context.tribes,commander));
  return context._facts.get(key);
}
function roleFor(c,context){
  if(!context._roles)context._roles=new Map();
  const key=norm(c);
  if(!context._roles.has(key))context._roles.set(key,role(c));
  return context._roles.get(key);
}
function targetLandCount(avg,ramps){
  // Broad baseline only. Dedicated low-land engines and fast mana are not
  // fully understood: use conservative guidance instead of declaring invalid.
  return Math.round(cap(37+(avg-3)*.85-Math.max(0,ramps-10)*.19,35,39));
}
function scoreCore(cards,commander,context){
  const spells=cards.filter(c=>!isLand(c));
  const lands=cards.filter(isLand);
  const facts=spells.map(c=>factsFor(c,commander,context));
  const counts=Object.fromEntries([...SPREAD,'synergy'].map(r=>[r,0]));
  for(const c of spells)counts[roleFor(c,context)]++;
  const enablers=facts.filter(f=>f.enabler||f.tribe).length;
  const payoffs=facts.filter(f=>f.payoff).length;
  const connected=facts.filter(f=>f.coherent).length;
  const intentional=Boolean(context.plan||context.tribes.length);
  const cohesionScore=intentional?
    Math.round(Math.min(100,35*Math.min(enablers/14,1)+
    35*Math.min(payoffs/9,1)+
    30*Math.min(connected/(spells.length*.52),1))):0;
  const cohWarnings=[];
  if(intentional&&enablers<9)cohWarnings.push('Engine lacks enough enablers ('+enablers+'); the plan may not start consistently.');
  if(intentional&&payoffs<5)cohWarnings.push('Engine has only '+payoffs+' clear payoffs; it may generate value without a win condition.');
  if(intentional&&connected<Math.ceil(spells.length*.35))
    cohWarnings.push('Only '+connected+' of '+spells.length+' nonland cards clearly connect to the game plan.');
  const coh={planKey:context.plan||(context.tribes.length?'tribal':null),
    plan:PLANS[context.plan]?.label||(context.tribes[0]?context.tribes.join('/')+' tribal':'General value'),
    enablers,payoffs,connected,score:cohesionScore,warnings:cohWarnings};
  const avg=averageSpellManaValue(spells);
  const rawParts={};
  const roles={};
  for(const key of SPREAD){
    rawParts[key]=WEIGHTS[key]*neededCount(counts[key],NEED[key]);
    roles[key]=counts[key];
  }
  const engine=20*coh.score/100;
  const mana=manaBalance(cards,commander);
  const landTarget=targetLandCount(avg,counts.ramp);
  const countPoints=11*cap(1-Math.abs(lands.length-landTarget)/10);
  const colorPoints=5*mana.score;
  const landPoints=countPoints+colorPoints;
  // Previous model warned about 31-33 lands but granted less than one point
  // to fixing each land, often preferring generic draw/removal instead.
  const deficit=Math.max(0,landTarget-lands.length);
  const landPenalty=Number((Math.pow(deficit,1.45)*1.8).toFixed(2));
  const curvePoints=6*cap(1-Math.abs(avg-3.0)/2.3);
  // Commander fit uses cached spell features; the leader-only text bonus is
  // still evaluated for alternate commander searches.
  const commanderPoints=commanderFit(commander,cards,context.plan,context.tribes,context);
  const strayPenalty=intentional?Math.max(0,spells.length*.28-connected)*.22:0;
  const score=cap(Object.values(rawParts).reduce((a,b)=>a+b,0)+engine+
    landPoints+curvePoints+commanderPoints-strayPenalty-landPenalty,0,100);
  const warnings=[...coh.warnings,...mana.warnings];
  if(lands.length<landTarget)warnings.push(lands.length+' lands: estimated target '+landTarget+' for this curve/ramp. Add '+(landTarget-lands.length)+' land(s), unless the deck has a proven low-land engine.');
  if(lands.length>landTarget+2)warnings.push(lands.length+' lands: estimated target '+landTarget+'. Check if the extra lands are necessary.');
  if(counts.ramp<7)warnings.push('Low ramp density ('+counts.ramp+').');
  if(counts.draw<7)warnings.push('Low card-advantage density ('+counts.draw+').');
  if(counts.removal<5)warnings.push('Few spot interactions ('+counts.removal+').');
  if(avg>4)warnings.push('High average nonland mana value ('+avg.toFixed(2)+').');
  return {score:Number(score.toFixed(2)),lands:lands.length,land_target:landTarget,
    average_cmc:Number(avg.toFixed(2)),roles,cohesion:coh,
    commander_fit:commanderPoints,connected,warnings,mana_balance:mana,
    breakdown:{roles:Number(Object.values(rawParts).reduce((a,b)=>a+b,0).toFixed(1)),
      engine:Number(engine.toFixed(1)),mana_base:Number(landPoints.toFixed(1)),
      land_penalty:-landPenalty,
      mana_curve:Number(curvePoints.toFixed(1)),commander:commanderPoints}};
}

export function rateDeck(cards,commander,context=null){
  const source=cards.map(coerce);
  const leader=coerce(commander);
  const ctx=context||{tribes:inferTribes(source,leader),plan:inferPlan(source,leader)};
  return {...scoreCore(source,leader,ctx),plan:ctx.plan,tribes:ctx.tribes.slice()};
}
function checkDeck(cards,commander){
  if(cards.length!==99)throw new DeckInputError('A full Commander deck needs 99 cards plus its commander.');
  if(!commander.commander || commander.eligible===false)throw new DeckInputError('The commander is not Commander-legal.');
  const seen=new Map([[norm(commander),1]]);
  for(const c of cards){
    if(c.eligible===false||!withinIdentity(c,commander))
      throw new DeckInputError(c.name+' is illegal in the selected commander identity.');
    const key=norm(c);
    const previous=seen.get(key)||0;
    if(previous && !duplicateAllowed(c))throw new DeckInputError('Singleton violation: '+c.name);
    seen.set(key,previous+1);
  }
}
/** Only propose swaps with a stated structural gain. Missing land counts
 * receive their own short candidate search instead of being crowded out by
 * hundreds of role-only suggestions. Hard limit evaluations per iteration.
 */
export function improveCards(cards,commander,candidates,{maxSwaps=8,minGain=.65,context=null,onProgress=null}={}){
  if(!Number.isInteger(maxSwaps)||maxSwaps<0||maxSwaps>20)
    throw new DeckInputError('Maximum suggested swaps must be between 0 and 20.');
  const leader=coerce(commander),original=cards.map(coerce);
  checkDeck(original,leader);
  const ctx=context||{tribes:inferTribes(original,leader),plan:inferPlan(original,leader)};
  const initial=rateDeck(original,leader,ctx);
  const selected=original.slice(),taken=new Set(selected.filter(c=>!duplicateAllowed(c)).map(norm));
  taken.add(norm(leader));
  const pool=[...new Map(candidates.map(coerce)
    .filter(c=>c.eligible && withinIdentity(c,leader) && norm(c)!==norm(leader))
    .map(c=>[norm(c),c])).values()];
  const swaps=[],usedPositions=new Set(),removedNames=new Set();
  let state=initial,totalEvaluations=0;
  const structural=card=>{
    const f=factsFor(card,leader,ctx);
    return f.score+(f.enabler?3:0)+(f.payoff?4:0)+(f.leaderSupport?2:0);
  };
  for(let step=0;step<maxSwaps;step++){
    const shortage=state.lands<state.land_target;
    const excess=state.lands>state.land_target+1;
    const needsColor=state.mana_balance.score<.995;
    // A missing land gets first attention even if the deck has lots of
    // spells competing for higher role/engine points.
    const available=pool.filter(c=>duplicateAllowed(c)||!taken.has(norm(c)));
    const landOptions=available.filter(isLand).sort((a,b)=>{
      const quality=c=>state.mana_balance.colors.reduce((sum,color)=>
        sum+(((c.produced_mana||[]).includes(color)||
          new RegExp('\\b'+({W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest'}[color])+'\\b').test(c.type_line))?
            Math.max(0,1-state.mana_balance.sources[color]/Math.max(1,state.mana_balance.targets[color])):0),0);
      return quality(b)-quality(a);
    }).slice(0,10);
    const spellOptions=available.filter(c=>!isLand(c)).sort((a,b)=>{
      const val=c=>structural(c)*1.8+
        ((roleFor(c,ctx)!=='synergy'&&state.roles[roleFor(c,ctx)]<(NEED[roleFor(c,ctx)]||0))?9:0)
        -Math.max(0,c.cmc-5);
      return val(b)-val(a);
    }).slice(0,22);
    const positions=selected.map((c,i)=>{
      const r=roleFor(c,ctx),f=factsFor(c,leader,ctx);
      const surplus=r!=='land'&&r!=='synergy'?Math.max(0,state.roles[r]-(NEED[r]||0)):0;
      return {c,i,weakness:isLand(c)?
        (excess?120:needsColor?28:-200):
        (shortage?50:0)+surplus*5-structural(c)*.85+
        Math.max(0,c.cmc-5)*.6+(r==='synergy'?7:0),
        protectedEngine:f.enabler||f.payoff||f.leaderSupport};
    }).filter(p=>!usedPositions.has(p.i))
      .sort((a,b)=>b.weakness-a.weakness);
    const fromPositions=shortage?positions.filter(p=>!isLand(p.c)).slice(0,14):
      excess?positions.filter(p=>isLand(p.c)).slice(0,12):
      [...positions.filter(p=>!isLand(p.c)).slice(0,15),
        ...positions.filter(p=>isLand(p.c)).slice(0,9)];
    let best=null;
    for(const {c:old,i,protectedEngine} of fromPositions){
      const oldRole=roleFor(old,ctx);
      const options=shortage?landOptions:excess?spellOptions:
        isLand(old)?landOptions:spellOptions;
      for(const nextCard of options){
        if(norm(old)===norm(nextCard)||removedNames.has(norm(nextCard)))continue;
        const oldLand=isLand(old),newLand=isLand(nextCard);
        if(shortage && (oldLand||!newLand))continue;
        if(excess && (!oldLand||newLand))continue;
        if(!shortage&&!excess && oldLand!==newLand)continue;
        if(oldLand&&newLand&&!needsColor)continue;
        if(!oldLand&&!newLand){
          // Never discard an existing trigger, engine enabler or payoff for
          // a generic off-theme staple. A role deficit alone is not proof.
          const before=factsFor(old,leader,ctx),after=factsFor(nextCard,leader,ctx);
          if(protectedEngine && structural(nextCard)<structural(old))continue;
          if(oldRole===roleFor(nextCard,ctx) && after.score<=before.score)continue;
        }
        if((oldRole==='ramp'||oldRole==='draw'||oldRole==='removal')&&
          state.roles[oldRole]<(NEED[oldRole]||0)&&oldRole!==roleFor(nextCard,ctx)&&!newLand)continue;
        selected[i]=nextCard;
        const result=scoreCore(selected,leader,ctx);
        selected[i]=old;
        totalEvaluations++;
        const gain=result.score-state.score;
        const confidence=oldLand!==newLand?'Land count':
          oldLand?'Mana source':
          'Role/synergy';
        const improvesLands=newLand&&!oldLand&&result.lands>state.lands;
        const improvesColors=oldLand&&newLand&&result.mana_balance.score>state.mana_balance.score;
        const improvesRole=!oldLand&&!newLand&&
          (result.cohesion.score>state.cohesion.score ||
           Object.keys(NEED).some(r=>state.roles[r]<NEED[r]&&result.roles[r]>state.roles[r]));
        if(!improvesLands&&!improvesColors&&!improvesRole)continue;
        const neededGain=oldLand&&newLand?.07:shortage?.10:minGain;
        if(gain<neededGain)continue;
        // Bias toward less disruption, not maximizing generic role counters.
        const preference=protectedEngine?-1:0;
        if(!best||gain>best.gain+.03||(Math.abs(gain-best.gain)<=.03&&preference>best.preference))
          best={i,old,added:nextCard,next:result,gain,preference,confidence};
      }
    }
    if(!best)break;
    selected[best.i]=best.added;
    usedPositions.add(best.i);
    removedNames.add(norm(best.old));
    if(!duplicateAllowed(best.old))taken.delete(norm(best.old));
    if(!duplicateAllowed(best.added))taken.add(norm(best.added));
    const oldReport=state,newReport=best.next;
    const changes=[];
    if(oldReport.lands!==newReport.lands)changes.push('Lands '+oldReport.lands+' → '+newReport.lands+
      ' (target '+newReport.land_target+')');
    for(const c of newReport.mana_balance.colors)
      if(oldReport.mana_balance.sources[c]!==newReport.mana_balance.sources[c])
        changes.push(c+' sources '+oldReport.mana_balance.sources[c]+' → '+newReport.mana_balance.sources[c]);
    for(const r of SPREAD)
      if(oldReport.roles[r]!==newReport.roles[r])changes.push(ROLE_NAMES[r]+
        ' '+oldReport.roles[r]+' → '+newReport.roles[r]);
    if(oldReport.cohesion.score!==newReport.cohesion.score)
      changes.push('Cohesion '+oldReport.cohesion.score+' → '+newReport.cohesion.score);
    swaps.push({
      out:best.old.name,in:best.added.name,gain:Number(best.gain.toFixed(2)),
      before:state.score,after:best.next.score,
      reason:best.confidence==='Land count'?'Fix land count':
        best.confidence==='Mana source'?'Improve colored mana access':
        'Improve missing role / recognizable synergy',
      evidence:changes.join(' · '),
      outCard:{name:best.old.name,image:best.old.image||'',url:best.old.url||''},
      inCard:{name:best.added.name,image:best.added.image||'',url:best.added.url||''}
    });
    state=best.next;
    if(typeof onProgress==='function')onProgress({done:swaps.length,max:maxSwaps,
      lands:state.lands,target:state.land_target});
  }
  checkDeck(selected,leader);
  return {cards:selected,commander:leader,before:initial,after:state,swaps,
    context:ctx,remaining:99-swaps.length,evaluations:totalEvaluations};
}

function viewCard(c,quantity=1){
  return {name:c.name,quantity,cmc:c.cmc,type:c.type_line,oracle_text:c.oracle_text,
    mana_cost:c.mana_cost,color_identity:c.color_identity,keywords:c.keywords||[],
    power:c.power||'',toughness:c.toughness||'',image:c.image||'',url:c.url||''};
}
export function deckView(cards,commander,metrics,label='Deck Doctor · Tuned'){
  const grouped=new Map();
  for(const c of cards){
    const key=role(c)==='land'?'Lands':isCreature(c)?'Creatures':'Spells';
    if(!grouped.has(key))grouped.set(key,new Map());
    const items=grouped.get(key),name=norm(c);
    if(items.has(name))items.get(name).quantity++;
    else items.set(name,viewCard(c));
  }
  const groups=[...grouped].map(([role,items])=>({role,cards:[...items.values()]}));
  const exportText='// Commander\n1 '+commander.name+'\n\n// Deck\n'+
    groups.flatMap(g=>g.cards.map(c=>c.quantity+' '+c.name)).join('\n')+'\n';
  return {name:commander.name+' — '+label,commander:viewCard(commander),
    description:'Minimally adjusted deck using documented construction and synergy heuristics.',
    groups,total_cards:100,export:exportText,quality_score:Math.round(metrics.score),
    confidence:metrics.score>=77?'High':metrics.score>=58?'Medium':'Low',
    average_cmc:metrics.average_cmc,target_cmc:null,theme_cards:metrics.connected,
    cohesion:metrics.cohesion,warnings:metrics.warnings,imported:true};
}
function ordered(pool,limit=150){
  const unique=new Map();
  for(const c of pool) if(c?.name && !unique.has(norm(c)))unique.set(norm(c),coerce(c));
  return [...unique.values()].slice(0,limit);
}
export class DeckDoctor {
  constructor(source=new ScryfallSource()){this.source=source;}
  async loadList(text,commanderName='',progress=()=>{}){
    progress('Checking uploaded card names and Commander legality against Scryfall…');
    const parsed=parseDecklist(text,commanderName);
    const leader=await lookupNamedCard(parsed.commander,this.source);
    if(!leader||!leader.eligible||!leader.commander)
      throw new DeckInputError('Commander is unknown or illegal: '+parsed.commander);
    const byName=await resolveCardNames(parsed.entries.map(c=>c.name),this.source);
    const cards=[];
    for(const entry of parsed.entries){
      const found=byName.get(cardNameKey(entry.name));
      if(!found)throw new DeckInputError('Cannot verify this card on Scryfall: '+entry.name);
      for(let i=0;i<entry.quantity;i++)cards.push(found);
    }
    checkDeck(cards,leader);
    return {cards,commander:coerce(leader),parsed};
  }
  async candidatePool(cards,commander,context,progress=()=>{}){
    const filter='id<='+([...(commander.color_identity||[])].sort().join('')||'C');
    const terms=THEME_SEARCHES[context.plan]||[];
    const queries=[
      ...terms.slice(0,2).map(q=>filter+' '+q+' -t:land'),
      ...context.tribes.slice(0,1).map(t=>filter+' t:"'+t+'" -t:land'),
      ...['o:"draw a card"','o:"search your library for a basic land"','o:"destroy target"','o:"create" o:"token"'].map(q=>filter+' '+q+' -t:land')
    ];
    const existing=cards.filter(c=>!isLand(c));
    const avg=averageSpellManaValue(existing);
    const pool=[];
    for(const q of queries.slice(0,7)){
      progress('Finding legal upgrades for '+(context.plan||context.tribes.join('/')||'the current strategy')+'…');
      pool.push(...await this.source.search(q,90));
    }
    // Search mana-base candidates even when the count is correct: color access
    // can be bad in a two/three-color deck with exactly 37 lands.
    const mana=manaBalance(cards,commander);
    const lands=cards.filter(isLand).length;
    if(lands<37 || mana.score<.99)
      pool.push(...await this.source.search(filter+' t:land -t:basic',90));
    const basicNames={W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest'};
    const neededBasics=mana.colors.map(c=>basicNames[c]);
    if(neededBasics.length)pool.push(...await this.source.collection(neededBasics));
    // Existing role seeds from Scryfall card collection can be reused as fallback.
    pool.push(...await this.source.collection(['Sol Ring','Arcane Signet','Swords to Plowshares',
      'Beast Within','Chaos Warp','Cultivate','Kodama\'s Reach','Counterspell',
      'Brainstorm','Night\'s Whisper','Harmonize','Skullclamp','Swiftfoot Boots']));
    const result=ordered(pool,900).filter(c=>c.eligible&&withinIdentity(c,commander));
    // Favor lower-curve candidates when the submitted curve is very high, but
    // never remove an expensive card solely due to its cost.
    result.sort((a,b)=>{
      const aa=synergyFeatures(a,context.plan,context.tribes,commander).score+
        (role(a)!=='synergy'?4:0)-Math.max(0,a.cmc-avg)*.3;
      const bb=synergyFeatures(b,context.plan,context.tribes,commander).score+
        (role(b)!=='synergy'?4:0)-Math.max(0,b.cmc-avg)*.3;
      return bb-aa;
    });
    return [...result.filter(isLand).slice(0,42),...result.filter(c=>!isLand(c)).slice(0,100)];
  }
  async alternativeCommander(cards,commander,context,currentScore,progress=()=>{},threshold=15){
    const plan=context.plan;
    const searches=[];
    if(plan && THEME_SEARCHES[plan]?.length)
      searches.push('is:commander '+THEME_SEARCHES[plan][0]);
    for(const type of context.tribes.slice(0,1))
      searches.push('is:commander o:"'+type+'"');
    if(!searches.length)return null;
    const options=[];
    for(const q of searches.slice(0,2)){
      progress('Comparing alternate commanders against the exact same 99 cards…');
      options.push(...await this.source.search(q,85));
    }
    let best=null;
    const checked=new Set();
    for(const candidate of options){
      if(checked.has(norm(candidate)))continue;
      checked.add(norm(candidate));
      if(!candidate.commander||!candidate.eligible||norm(candidate)===norm(commander))continue;
      // Commander swap means absolutely no other card change, including lands.
      if(cards.some(c=>!withinIdentity(c,candidate)||norm(c)===norm(candidate)))continue;
      const score=rateDeck(cards,candidate,context);
      const difference=score.score-currentScore.score;
      if(difference>=threshold && (!best||difference>best.gain))
        best={commander:coerce(candidate),score,gain:Number(difference.toFixed(2)),
          reason:'Commander-only score improvement without changing any of the 99 cards'};
    }
    return best;
  }
  async diagnose(text,{commander='',maxSwaps=8,considerCommander=true}={},progress=()=>{}){
    const loaded=await this.loadList(text,commander,progress);
    const context={tribes:inferTribes(loaded.cards,loaded.commander),plan:inferPlan(loaded.cards,loaded.commander)};
    const original=rateDeck(loaded.cards,loaded.commander,context);
    progress('Evaluating structure, roles, cohesion, mana curve and minimal-change upgrades…');
    const pool=maxSwaps?await this.candidatePool(loaded.cards,loaded.commander,context,progress):[];
    const tuned=improveCards(loaded.cards,loaded.commander,pool,{maxSwaps,context});
    let suggestion=null;
    if(considerCommander) {
      // The threshold is deliberately high: a commander change only qualifies
      // if it improves the score by at least 15 points BEFORE other card swaps.
      suggestion=await this.alternativeCommander(loaded.cards,loaded.commander,context,original,progress,15);
    }
    const originalDeck=deckView(loaded.cards,loaded.commander,original,'Deck Doctor · Original');
    const upgradedDeck=deckView(tuned.cards,tuned.commander,tuned.after,'Deck Doctor · Minimal changes');
    const commanderOnlyDeck=suggestion?
      deckView(loaded.cards,suggestion.commander,suggestion.score,'Deck Doctor · Commander-only alternative'):null;
    return {original,upgraded:tuned.after,swaps:tuned.swaps,originalDeck,upgradedDeck,
      originalCommander:loaded.commander.name,commanderSuggestion:suggestion,commanderOnlyDeck,
      keptCount:99-tuned.swaps.length,maxSwaps,context,considerCommander};
  }
}
