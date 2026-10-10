/** Local deck library and approximate two-player strategy simulator.
 * Not a Magic rules engine: card targeting, layers, stack, triggered abilities,
 * combat blockers, timing, mana colors and replacement effects are modeled heuristically.
 */
import {ScryfallSource, withinIdentity, DeckInputError} from './generator.mjs';
import {deckPlan, synergyFeatures} from './synergy.mjs';
const BASIC=/^(plains|island|swamp|mountain|forest|wastes)$/i;
const NAME=String;
export function parseDecklist(text, commanderName='') {
  const lines=String(text || '').split(/\r?\n/);
  const cards=new Map();
  let section='',commander=String(commanderName||'').trim();
  for(const original of lines) {
    const line=original.trim();
    if(!line) continue;
    if(/^\/\/\s*commander\b|^\[commander\]$|^commander\s*:?$/i.test(line)){section='commander';continue;}
    if(/^\/\/\s*deck\b|^\[deck\]$|^deck\s*:?$|^mainboard\s*:?$/i.test(line)){section='deck';continue;}
    if(/^\/\/|^#|^sideboard\b|^maybeboard\b|^\[sideboard\]/i.test(line)){if(/sideboard|maybeboard/i.test(line)) section='ignore';continue;}
    if(section==='ignore')continue;
    const match=line.match(/^(\d{1,3})\s*x?\s+(.+)$/i);
    if(!match) throw new DeckInputError('Unrecognized decklist line: '+line.slice(0,80));
    const quantity=Number(match[1]);
    const name=match[2].replace(/\s+\([A-Z0-9]{2,8}\)\s*\d*\s*$/i,'').replace(/\s+\*\S+\*\s*$/,'').trim();
    if(!name || quantity<1 || quantity>99) throw new DeckInputError('Invalid card quantity on line: '+line);
    if(section==='commander'){
      if(quantity!==1 || (commander && commander.toLowerCase()!==name.toLowerCase()))
        throw new DeckInputError('Only one single-card commander is supported. Check the Commander section.');
      commander=name;
    } else cards.set(name,(cards.get(name)||0)+quantity);
  }
  if(!commander) throw new DeckInputError('Enter the opponent commander name (or add a Commander section).');
  // Lists without a Commander header may include the commander among their 100 cards.
  for(const [name,qty] of cards) if(name.toLowerCase()===commander.toLowerCase()){
    if(qty!==1) throw new DeckInputError('The commander must appear exactly once.');
    cards.delete(name);
  }
  const count=[...cards.values()].reduce((a,b)=>a+b,0);
  if(count!==99) throw new DeckInputError('A 1v1 Commander deck must contain 99 main-deck cards plus its commander; found '+count+' main-deck cards.');
  return {commander,entries:[...cards.entries()].map(([name,quantity])=>({name,quantity}))};
}
function cardView(card,quantity=1){
  return {name:card.name,quantity,cmc:card.cmc,type:card.type_line,mana_cost:card.mana_cost,
    oracle_text:card.oracle_text,keywords:card.keywords,power:card.power,toughness:card.toughness,
    image:card.image,url:card.url,color_identity:card.color_identity};
}
export async function importDecklist(text, commanderName='', source=new ScryfallSource()){
  const parsed=parseDecklist(text,commanderName);
  const commander=await source.named(parsed.commander);
  if(!commander || !commander.eligible || !commander.commander)
    throw new DeckInputError('Commander not found or illegal: '+parsed.commander+'.');
  const found=await source.collection(parsed.entries.map(c=>c.name));
  const lookup=new Map(found.map(c=>[c.name.toLowerCase(),c]));
  const groups=new Map();
  const seen=new Set([commander.name.toLowerCase()]);
  for(const entry of parsed.entries) {
    const card=lookup.get(entry.name.toLowerCase());
    if(!card) throw new DeckInputError('Card could not be verified with Scryfall: '+entry.name);
    if(!card.eligible || !withinIdentity(card,commander))
      throw new DeckInputError('Card is illegal with this commander: '+entry.name);
    const duplicate=seen.has(card.name.toLowerCase()) || entry.quantity>1;
    // Some cards explicitly override the singleton rule.
    const repeats=card.basic||/\b(a deck can have any number|a deck can have up to)\b/i.test(card.oracle_text);
    if(duplicate&&!repeats)throw new DeckInputError('Commander singleton violation: '+entry.name);
    seen.add(card.name.toLowerCase());
    const role=card.land?'Lands':card.creature?'Creatures':'Other spells';
    if(!groups.has(role))groups.set(role,[]);
    groups.get(role).push(cardView(card,entry.quantity));
  }
  return {
    name:commander.name+' — Imported deck',
    commander:cardView(commander),
    groups:[...groups].map(([role,cards])=>({role,cards})),
    total_cards:100,
    export:'// Commander\n1 '+commander.name+'\n\n// Deck\n'+parsed.entries.map(e=>e.quantity+' '+e.name).join('\n')+'\n',
    imported:true,warnings:[],cohesion:null
  };
}
const KEY='xper_mDm.deck_library.v1';
export class DeckLibrary {
  constructor(storage){this.storage=storage;}
  list(){
    try{
      const data=JSON.parse(this.storage.getItem(KEY)||'[]');
      return Array.isArray(data)?data.filter(d=>d&&typeof d.id==='string'&&d.deck?.commander).slice(0,12):[];
    }catch{return [];}
  }
  save(deck,title=''){
    if(!deck||deck.total_cards!==100||!deck.commander?.name)throw new DeckInputError('Save a complete 100-card deck.');
    const items=this.list();
    const id='deck-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    items.unshift({id,name:String(title||deck.name||deck.commander.name).trim().slice(0,100),savedAt:new Date().toISOString(),deck});
    try {this.storage.setItem(KEY,JSON.stringify(items.slice(0,12)));}
    catch {throw new DeckInputError('Browser storage is unavailable or full. Delete an old saved deck or enable local storage.');}
    return id;
  }
  remove(id){this.storage.setItem(KEY,JSON.stringify(this.list().filter(item=>item.id!==id)));}
  get(id){return this.list().find(item=>item.id===id)?.deck||null;}
}
function rng(seed) {
  let state=(Number(seed)||1)>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
function shuffle(cards,random){
  const list=cards.slice();
  for(let i=list.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  return list;
}
function expand(deck) {
  if(!deck || deck.total_cards!==100||!deck.commander)throw new DeckInputError('Playtests require complete 100-card decks.');
  const cards=(deck.groups||[]).flatMap(g=>g.cards||[]);
  const list=[];
  for(const card of cards){
    if(!Number.isInteger(Number(card.quantity))||card.quantity<1)throw new DeckInputError('Invalid saved deck card quantity.');
    for(let j=0;j<card.quantity;j++)list.push({...card});
  }
  if(list.length!==99)throw new DeckInputError('Deck has '+list.length+' cards, expected 99 plus commander.');
  return list;
}
const typeOf=c=>String(c.type||c.type_line||'');
const oracle=c=>String(c.oracle_text||'').toLowerCase();
const isLand=c=>/\bland\b/i.test(typeOf(c).split(' — ')[0].split(' // ')[0]);
const isCreature=c=>/\bcreature\b/i.test(typeOf(c));
const has=(c,exp)=>exp.test(oracle(c));
function attributes(c) {
  const text=oracle(c),type=typeOf(c),creature=isCreature(c);
  return {
    creature,land:isLand(c),mv:Number(c.cmc)||0,
    ramp:/add \{|search your library for .*land|treasure token|add one mana/.test(text),
    draw:/draw (a|two|three|x|that many) cards?/.test(text),
    removal:/destroy target|exile target|deals? .*damage to target|return target .* to .*hand/.test(text),
    wipe:/destroy all creatures|exile all creatures|each creature gets -/.test(text),
    token:/create .*creature token/.test(text),
    lifegain:/you gain .*life|lifelink/.test(text),
    power:Number.parseInt(c.power,10)||Math.max(1,Math.round((Number(c.cmc)||2)*.65)),
    type
  };
}
function rating(c,me,foe) {
  const a=attributes(c),plan=me.plan,engine=synergyFeatures(c,plan,[],me.commander).score;
  let score=engine*.45 + (a.creature?5+Math.min(5,a.power):0)+(a.draw&&me.hand.length<4?9:0)+(a.ramp&&me.turn<6?13:0)+
    (a.removal&&foe.board.length?12:0)+(a.wipe&&foe.board.length>me.board.length+2?22:-25)+
    (a.token?7:0)+(a.lifegain&&me.life<18?5:0);
  if(!a.creature&&!a.ramp&&!a.draw&&!a.removal&&!a.wipe&&!a.token)score-=3;
  return score-a.mv*.25;
}
function createPlayer(deck,random,first) {
  const pile=shuffle(expand(deck),random);
  // Simplified opening: 7 cards, a single free reshuffle if 0-1 or 6+ lands.
  let hand=pile.splice(0,7);
  const lands=cards=>cards.filter(isLand).length;
  if(lands(hand)<2||lands(hand)>5){pile.push(...hand);const next=shuffle(pile,random);pile.splice(0,pile.length,...next);hand=pile.splice(0,7);}
  return {name:deck.commander.name,commander:deck.commander,deck:pile,hand,
    board:[],lands:0,ramp:0,life:40,turn:0,castCommander:false,tax:0,plan:deck.cohesion?.planKey||null,first};
}
function cast(c,me,foe,turn,events){
  const a=attributes(c);const name=c.name;
  if(a.wipe){
    const yours=me.board.length,theirs=foe.board.length;me.board=[];foe.board=[];
    events.push(name+' sweeps '+(yours+theirs)+' simulated creatures.');
  }else if(a.removal&&foe.board.length){
    foe.board.sort((x,y)=>y.power-x.power);
    const target=foe.board.shift();events.push(name+' answers '+target.name+'.');
  }
  if(a.draw){
    const draws=/draw (two|three) cards/.test(oracle(c))?2:1;
    for(let n=0;n<draws&&me.deck.length;n++)me.hand.push(me.deck.shift());
  }
  if(a.ramp)me.ramp+=1;
  if(a.lifegain)me.life=Math.min(80,me.life+2);
  if(a.creature)me.board.push({name,power:Math.min(13,a.power),born:turn,commander:name===me.commander.name});
  if(a.token)me.board.push({name:name+' token',power:1,born:turn,commander:false});
}
function playTurn(me,foe,turn,events){
  me.turn=turn;
  if(!me.first||turn!==1)if(me.deck.length)me.hand.push(me.deck.shift());else {me.life=0;events.push(me.name+' runs out of cards.');return;}
  const landIndex=me.hand.findIndex(isLand);
  if(landIndex!==-1){const land=me.hand.splice(landIndex,1)[0];me.lands++;events.push(me.name+' plays '+land.name+'.');}
  let mana=me.lands+me.ramp,plays=0;
  while(plays++<12) {
    const choices=me.hand.map((c,index)=>({c,index,mv:Math.max(0,Number(c.cmc)||0)}))
      .filter(x=>!isLand(x.c)&&x.mv<=mana);
    if(!me.castCommander && (Number(me.commander.cmc)||0)+me.tax<=mana)
      choices.push({c:me.commander,index:-1,mv:(Number(me.commander.cmc)||0)+me.tax});
    if(!choices.length)break;
    choices.sort((a,b)=>rating(b.c,me,foe)-rating(a.c,me,foe));
    const play=choices[0];
    if(play.index===-1)me.castCommander=true;else me.hand.splice(play.index,1);
    mana-=play.mv;events.push(me.name+' casts '+play.c.name+'.');
    cast(play.c,me,foe,turn,events);
  }
  // Strategic combat approximation. A defender's board absorbs expected combat power,
  // rather than Magic's legal blocker assignments, first strike or damage prevention.
  const attack=me.board.filter(unit=>unit.born<turn).reduce((sum,unit)=>sum+unit.power,0);
  if(attack>0) {
    const cover=foe.board.reduce((n,unit)=>n+unit.power,0);
    const dealt=Math.max(0,attack-Math.floor(cover*.65));
    if(dealt){foe.life-=dealt;events.push(me.name+' attacks for approximately '+dealt+' damage.');}
  }
}
export function simulateMatch(left,right,options={}) {
  const seed=Number(options.seed)||1,turnLimit=Math.max(3,Math.min(25,Number(options.turns)||12));
  const random=rng(seed);
  const a=createPlayer(left,random,true),b=createPlayer(right,random,false);
  // A match is a 40-life strategy-model approximation, NOT a legal execution of cards.
  const log=[];
  let winner=null,projected=false,turn=0;
  for(let n=1;n<=turnLimit;n++){
    turn=n;log.push('TURN '+n);
    playTurn(a,b,n,log);
    if(a.life<=0||b.life<=0){winner=a.life<=0?'opponent':'your deck';break;}
    playTurn(b,a,n,log);
    if(a.life<=0||b.life<=0){winner=a.life<=0?'opponent':'your deck';break;}
  }
  if(!winner){
    projected=true;
    const potential=p=>p.life+p.board.reduce((sum,c)=>sum+c.power,0)*1.6+p.lands*.4+p.hand.length*.25;
    const difference=potential(a)-potential(b);
    winner=Math.abs(difference)<2?'draw':difference>0?'your deck':'opponent';
    log.push('Turn limit reached; outcome projected from life, threats and resources, not an actual Magic win.');
  }
  return {winner,projected,turn,seed,log,life:[a.life,b.life],board:[a.board.length,b.board.length],
    hands:[a.hand.length,b.hand.length],name:[a.name,b.name]};
}
export function simulateSeries(left,right,iterations=20,seed=41){
  const count=Math.max(1,Math.min(60,Math.round(iterations)));
  const games=Array.from({length:count},(_,i)=>simulateMatch(left,right,{seed:seed+i*97,turns:12}));
  const wins=games.filter(g=>g.winner==='your deck').length,losses=games.filter(g=>g.winner==='opponent').length;
  return {count,wins,losses,draws:count-wins-losses,example:games[0],projected:games.filter(g=>g.projected).length};
}
