/** Deck Doctor — objective-driven, minimal-change Commander repair.
 * Results are heuristic construction ratings, NOT observed win-rates, combo proofs,
 * or a guarantee of competitive strength. Every proposed addition is checked
 * against Scryfall legalities and full commander color identity.
 */
import {ScryfallSource,DeckInputError,withinIdentity,roleMatch,cardFromScryfall} from './generator.mjs';
import {parseDecklist} from './playtest.mjs';
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
function commanderFit(commander,cards,plan,tribes){
  const oracle=lower(commander.oracle_text);
  const total=cards.filter(c=>!isLand(c)).length;
  const matched=cards.filter(c=>!isLand(c) && synergyFeatures(c,plan,tribes,commander).coherent).length;
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
function scoreCore(cards,commander,context){
  const spells=cards.filter(c=>!isLand(c));
  const lands=cards.filter(isLand);
  const counts=Object.fromEntries([...SPREAD,'synergy'].map(r=>[r,0]));
  for(const c of spells)counts[role(c)]++;
  const coh=cohesionReport(spells,context.plan,context.tribes,commander);
  const avg=averageSpellManaValue(spells);
  const rawParts={};
  const roles={};
  for(const key of SPREAD){
    const value=WEIGHTS[key]*neededCount(counts[key],NEED[key]);
    rawParts[key]=value;
    roles[key]=counts[key];
  }
  const engine=20*coh.score/100;
  const landPoints=10*cap(1-Math.abs(lands.length-37)/12);
  const curvePoints=6*cap(1-Math.abs(avg-3.0)/2.3);
  const commanderPoints=commanderFit(commander,cards,context.plan,context.tribes);
  // Gentle pressure to avoid decks with lots of totally disconnected cards
  const connected=spells.filter(c=>synergyFeatures(c,context.plan,context.tribes,commander).coherent).length;
  const strayPenalty=(context.plan||context.tribes.length)?Math.max(0,(spells.length*.28-connected))*.22:0;
  const score=cap(Object.values(rawParts).reduce((a,b)=>a+b,0)+engine+
    landPoints+curvePoints+commanderPoints-strayPenalty,0,100);
  const warnings=[...coh.warnings];
  if(lands.length<34||lands.length>40)warnings.push(lands.length+' lands: recommended starting point is around 37, adjusted for your build.');
  if(counts.ramp<7)warnings.push('Low ramp density ('+counts.ramp+').');
  if(counts.draw<7)warnings.push('Low card-advantage density ('+counts.draw+').');
  if(counts.removal<5)warnings.push('Few spot interactions ('+counts.removal+').');
  if(avg>4)warnings.push('High average nonland mana value ('+avg.toFixed(2)+').');
  return {score:Number(score.toFixed(2)),lands:lands.length,average_cmc:Number(avg.toFixed(2)),
    roles,cohesion:coh,commander_fit:commanderPoints,connected,warnings,
    breakdown:{roles:Number(Object.values(rawParts).reduce((a,b)=>a+b,0).toFixed(1)),
      engine:Number(engine.toFixed(1)),mana_base:Number(landPoints.toFixed(1)),
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
export function improveCards(cards,commander,candidates,{maxSwaps=8,minGain=1.25,context=null}={}){
  if(!Number.isInteger(maxSwaps)||maxSwaps<0||maxSwaps>20)
    throw new DeckInputError('Maximum suggested swaps must be between 0 and 20.');
  const leader=coerce(commander),original=cards.map(coerce);
  checkDeck(original,leader);
  const ctx=context||{tribes:inferTribes(original,leader),plan:inferPlan(original,leader)};
  const initial=rateDeck(original,leader,ctx);
  const selected=original.slice(),taken=new Set(selected.filter(c=>!duplicateAllowed(c)).map(norm));
  taken.add(norm(leader));
  const pool=candidates.map(coerce).filter(c=>c.eligible && withinIdentity(c,leader) && norm(c)!==norm(leader));
  const swaps=[];
  let state=initial;
  // Optimize with the *same* objective and context each iteration (never shift
  // strategic goals to manufacture a score increase).
  for(let step=0;step<maxSwaps;step++){
    let best=null;
    // Evaluate a few strategically weak slots first, but permit changes anywhere.
    // Basic lands can be replaced to correct land counts.
    const positions=selected.map((c,i)=>({c,i}));
    const poolAvailable=pool.filter(c=>duplicateAllowed(c)||!taken.has(norm(c)));
    for(const {c:old,i} of positions){
      const oldRole=role(old);
      for(const c of poolAvailable){
        if(norm(old)===norm(c)||isLand(c)!==isLand(old)&&Math.abs(state.lands-37)<2)continue;
        if(isLand(old)&&isLand(c)&&Math.abs(state.lands-37)<2)continue;
        // Avoid replacing required basics or dismantling working role engines for tiny gains.
        selected[i]=c;
        const next=scoreCore(selected,leader,ctx);
        selected[i]=old;
        const gain=next.score-state.score;
        if(gain<minGain)continue;
        // A role-preserving swap is preferred in close ties, and one cannot
        // change the same position repeatedly without improving the score.
        const preference=(role(c)===oldRole?.12:0)+(isLand(c)===isLand(old)?.06:0);
        if(!best || gain>best.gain+.015 ||
          (Math.abs(gain-best.gain)<=.015 && preference>best.preference)){
          best={i,old,added:c,next,gain,preference};
        }
      }
    }
    if(!best)break;
    selected[best.i]=best.added;
    if(!duplicateAllowed(best.old))taken.delete(norm(best.old));
    if(!duplicateAllowed(best.added))taken.add(norm(best.added));
    swaps.push({out:best.old.name,in:best.added.name,gain:Number(best.gain.toFixed(2)),
      before:state.score,after:best.next.score,reason:ROLE_NAMES[role(best.added)]||'Deck structure'});
    state=best.next;
  }
  checkDeck(selected,leader);
  return {cards:selected,commander:leader,before:initial,after:state,swaps,
    context:ctx,remaining:99-swaps.length};
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
    const leader=await this.source.named(parsed.commander);
    if(!leader||!leader.eligible||!leader.commander)
      throw new DeckInputError('Commander is unknown or illegal: '+parsed.commander);
    const fetched=await this.source.collection(parsed.entries.map(c=>c.name));
    const byName=new Map(fetched.map(c=>[norm(c),coerce(c)]));
    const cards=[];
    for(const entry of parsed.entries){
      const found=byName.get(lower(entry.name));
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
    const lands=cards.filter(isLand).length;
    if(lands<35)pool.push(...await this.source.search(filter+' t:land -t:basic',80));
    // Existing role seeds from Scryfall card collection can be reused as fallback.
    pool.push(...await this.source.collection(['Sol Ring','Arcane Signet','Swords to Plowshares',
      'Beast Within','Chaos Warp','Cultivate','Kodama\'s Reach','Counterspell',
      'Brainstorm','Night\'s Whisper','Harmonize','Skullclamp','Swiftfoot Boots']));
    const result=ordered(pool,360).filter(c=>c.eligible&&withinIdentity(c,commander));
    // Favor lower-curve candidates when the submitted curve is very high, but
    // never remove an expensive card solely due to its cost.
    result.sort((a,b)=>{
      const aa=synergyFeatures(a,context.plan,context.tribes,commander).score+
        (role(a)!=='synergy'?4:0)-Math.max(0,a.cmc-avg)*.3;
      const bb=synergyFeatures(b,context.plan,context.tribes,commander).score+
        (role(b)!=='synergy'?4:0)-Math.max(0,b.cmc-avg)*.3;
      return bb-aa;
    });
    return result.slice(0,120);
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
    return {original,upgraded:tuned.after,swaps:tuned.swaps,originalDeck,upgradedDeck,
      originalCommander:loaded.commander.name,commanderSuggestion:suggestion,
      keptCount:99-tuned.swaps.length,maxSwaps,context,considerCommander};
  }
}
