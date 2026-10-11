/**
 * Interactive, local-only Commander practice duel.
 *
 * Intentional limitations: this is a bounded teaching/playtesting simulator,
 * NOT a comprehensive Magic rules engine. Mana, basic creatures, simple removal,
 * simplified combat, one-land-per-turn, commander tax, and basic effects are
 * implemented. The stack, triggers, replacement effects, most activated
 * abilities, timing, and many card-specific rules are NOT implemented.
 */
import {DeckInputError} from './generator.mjs';
import {normalizeMulliganMode,bottomRequired,bottomSelected,chooseBotBottom} from './mulligan.mjs';

const lc=value=>String(value||'').toLowerCase();
const typeOf=card=>String(card.type||card.type_line||'').split(' // ')[0];
const isLand=card=>/\bLand\b/.test(typeOf(card).split(' — ')[0]);
const isCreature=card=>/\bCreature\b/.test(typeOf(card).split(' — ')[0]);
const isPermanent=card=>/\b(Artifact|Creature|Enchantment|Planeswalker|Battle)\b/.test(typeOf(card).split(' — ')[0]);
const textOf=card=>lc(card.oracle_text);
const has=(card,word)=>lc((card.keywords||[]).join(' ')).includes(word)||new RegExp('\\b'+word+'\\b','i').test(card.oracle_text||'');
const atLeast=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function randomizer(seed=17){let v=(Number(seed)||17)>>>0;return ()=>((v=(Math.imul(v,1664525)+1013904223)>>>0)/4294967296);}
function shuffle(cards,rand){const a=cards.slice();for(let i=a.length-1;i>0;i--){const k=Math.floor(rand()*(i+1));[a[i],a[k]]=[a[k],a[i]];}return a;}
export function expandMain(deck) {
  if(!deck||deck.total_cards!==100||!deck.commander)throw new DeckInputError('A live match requires a complete 100-card Commander deck.');
  const cards=[];
  for(const group of deck.groups||[])for(const card of group.cards||[]){
    const qty=Number(card.quantity);
    if(!Number.isInteger(qty)||qty<1||qty>99)throw new DeckInputError('Invalid quantity for '+card.name);
    for(let i=0;i<qty;i++)cards.push({...card});
  }
  if(cards.length!==99)throw new DeckInputError('Expected exactly 99 cards outside the command zone.');
  return cards;
}
function basicColors(card) {
  const head=typeOf(card);
  const found=[];
  for(const [type,color] of Object.entries({Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'}))
    if(new RegExp('\\b'+type+'\\b').test(head))found.push(color);
  if(/\bWastes\b/.test(card.name))found.push('C');
  return found;
}
export function manaSource(card,identity=[]) {
  const text=textOf(card),values=new Set([...(card.produced_mana||[]),...basicColors(card)]);
  for(const symbol of (text.match(/add (?:[^.]*?)\{[wubrgc]\}/g)||[]))
    for(const letter of symbol.match(/\{[wubrgc]\}/g)||[])values.add(letter[1].toUpperCase());
  if(/add (?:one|two|three|an amount of) mana of any (?:one )?color/.test(text))
    for(const color of identity)values.add(color);
  if(isLand(card)&&values.size===0)values.add('C');
  const mult=/add \{c\}\{c\}/.test(text)?2:1;
  return {colors:[...values],amount:mult};
}
function costOf(card,tax=0) {
  const value=String(card.mana_cost||'').split(' // ')[0];
  const symbols=[...value.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]);
  if(!symbols.length) {
    const mv=Number(card.cmc)||0;
    return {generic:mv+tax,colors:[],unsupported:false};
  }
  let generic=tax,unsupported=false;
  const colors=[];
  for(const s of symbols) {
    if(/^\d+$/.test(s))generic+=Number(s);
    else if(/^[WUBRGC]$/.test(s))colors.push([s]);
    else if(s==='X'){} // X=0 in this lightweight engine
    else if(/^[WUBRG]\/[WUBRG]$/.test(s))colors.push(s.split('/'));
    else if(/^2\/[WUBRG]$/.test(s))generic+=2;
    else unsupported=true;
  }
  return {generic,colors,unsupported};
}
function sourcePicks(sources,cost) {
  if(cost.unsupported)return null;
  const pool=[];
  sources.forEach((source,index)=>{
    const {colors,amount}=manaSource(source.card,source.identity||[]);
    for(let n=0;n<amount;n++)pool.push({index,colors});
  });
  if(pool.length<cost.generic+cost.colors.length)return null;
  const used=new Set(),allocated=[];
  const req=[...cost.colors].sort((a,b)=>a.length-b.length);
  for(const options of req) {
    let pick=-1,score=-1;
    pool.forEach((source,index)=>{
      if(used.has(index))return;
      if(!options.some(c=>source.colors.includes(c)))return;
      const flexibility=source.colors.length;
      const rank=10-flexibility;
      if(rank>score){score=rank;pick=index;}
    });
    if(pick<0)return null;
    used.add(pick);allocated.push(pool[pick].index);
  }
  // Each source can supply up to its stated amount; source IDs may appear twice.
  let remain=cost.generic;
  for(let i=0;i<pool.length&&remain;i++)if(!used.has(i)) {
    used.add(i);allocated.push(pool[i].index);remain--;
  }
  return remain?null:[...new Set(allocated)];
}
function powered(card) {
  const number=parseInt(String(card.power||''),10);
  return Number.isFinite(number)?atLeast(number,0,25):Math.max(1,Math.round((Number(card.cmc)||2)*.65));
}
function toughness(card) {
  const number=parseInt(String(card.toughness||''),10);
  return Number.isFinite(number)?atLeast(number,1,25):Math.max(1,Math.round((Number(card.cmc)||2)*.65));
}
function cardStrength(card){return powered(card)+(has(card,'flying')?1.5:0)+(has(card,'trample')?0.6:0);}
function effectiveColors(card,identity){return manaSource(card,identity);}
function newPlayer(deck,random){
  const library=shuffle(expandMain(deck),random);
  const hand=library.splice(0,7);
  return {name:deck.commander.name,commander:{...deck.commander},library,hand,
    battlefield:[],graveyard:[],exile:[],life:40,landDrops:0,commanderTax:0,
    commanderInZone:true,commanderDamage:0,turns:0,mulligans:0,kept:false};
}
export class LiveDuel {
  constructor(mine,opponent,{seed=17,mulliganMode='friendly'}={}) {
    this.mulliganMode=normalizeMulliganMode(mulliganMode);
    this.random=randomizer(seed);this.players=[newPlayer(mine,this.random),newPlayer(opponent,this.random)];
    this.id=0;this.round=1;this.serial=0;this.phase='opening';this.winner=null;
    this.log=['Practice match prepared. This is a simplified rules sandbox, not full Magic.'];
    this.pendingAttack=[];this.attackOwner=0;this.humanAttacked=false;this.pendingAi=null;
    this.playerManaBonus=0;this.usedBonus=0;
    const bot=this.players[1];
    while(bot.mulligans<3 && (this._landCount(bot.hand)<2||this._landCount(bot.hand)>5))this._mulligan(1);
    bot.kept=true;
    const botRequired=bottomRequired(this.mulliganMode,bot.mulligans);
    if(botRequired){
      const selected=chooseBotBottom(bot.hand,botRequired);
      bottomSelected(bot.hand,bot.library,selected,botRequired);
      this._log('AI took '+bot.mulligans+' strict mulligan(s), bottomed '+botRequired+' cards and kept '+bot.hand.length+'.');
    } else if(bot.mulligans) this._log('AI took '+bot.mulligans+' friendly mulligan(s) and kept seven.');
  }
  _landCount(cards){return cards.filter(isLand).length;}
  _log(message){this.log.push(message);if(this.log.length>250)this.log.shift();}
  _require(...allowed){if(!allowed.includes(this.phase)||this.winner)throw new DeckInputError('That action is not available during '+this.phase+'.');}
  _mulligan(side){
    const p=this.players[side];if(p.kept)throw new DeckInputError('Opening hand has been kept.');
    if(this.mulliganMode==='strict' && p.mulligans>=8)
      throw new DeckInputError('At most eight Strict mulligans can be used with a seven-card opening hand.');
    const all=shuffle([...p.library,...p.hand],this.random);
    p.hand=all.splice(0,7);p.library=all;p.mulligans++;
  }
  mulligan(){
    this._require('opening');
    this._mulligan(0);
    this._log('You take mulligan #'+this.players[0].mulligans+' ('+this.mulliganMode+').');
    return this.view();
  }
  keep(){
    this._require('opening');
    const p=this.players[0];p.kept=true;
    const count=bottomRequired(this.mulliganMode,p.mulligans);
    if(count>0){this.phase='bottom';this._log('Select exactly '+count+' card(s) to put on the bottom of your library.');}
    else this._startTurn(0,true);
    return this.view();
  }
  putOnBottom(indices){
    this._require('bottom');
    const p=this.players[0];
    const count=bottomRequired(this.mulliganMode,p.mulligans);
    const bottomed=bottomSelected(p.hand,p.library,indices,count);
    this._log('You put '+bottomed.length+' card(s) on the bottom and keep '+p.hand.length+'.');
    this._startTurn(0,true);
    return this.view();
  }
  _draw(side,n=1) {
    const p=this.players[side];
    for(let i=0;i<n;i++) {
      if(!p.library.length){this._endGame(1-side,p.name+' cannot draw from an empty library.');return;}
      p.hand.push(p.library.shift());
    }
  }
  _startTurn(side,opening=false) {
    const p=this.players[side];
    p.turns++;p.landDrops=0;
    for(const object of p.battlefield)object.tapped=false;
    if(!opening)this._draw(side);
    if(this.winner)return;
    this.playerManaBonus=0;this.usedBonus=0;
    this.phase=side===0?'main':'bot';
    this._log((side?'Opponent':'You')+' begin turn '+p.turns+'.');
  }
  _id(){return ++this.serial;}
  _addPermanent(side,card,tapped=false) {
    const object={uid:this._id(),card:{...card},tapped,entered:this.serial,enteredRound:this.round,
      enteredTurn:this.players[side].turns,commander:card.name===this.players[side].commander.name,
      identity:this.players[side].commander.color_identity||[]};
    this.players[side].battlefield.push(object);
    return object;
  }
  playLand(index) {
    this._require('main');
    const p=this.players[0],card=p.hand[index];
    if(!card||!isLand(card))throw new DeckInputError('Choose a land from your hand.');
    if(p.landDrops>=1)throw new DeckInputError('You have already played a land this turn.');
    p.hand.splice(index,1);p.landDrops++;
    this._addPermanent(0,card);this._log('You play '+card.name+'.');
    return this.view();
  }
  _sources(side) {
    const p=this.players[side];
    return p.battlefield.filter(obj=>{
      if(obj.tapped)return false;
      if(isLand(obj.card))return true;
      if(!/(add \{|add one mana|add .* mana of any color)/.test(textOf(obj.card)))return false;
      return !isCreature(obj.card)||obj.enteredTurn!==p.turns||has(obj.card,'haste');
    });
  }
  _canPay(side,card,tax=0) {
    const sources=this._sources(side);
    const cost=costOf(card,tax);
    if(this.playerManaBonus>this.usedBonus){const bonus=this.playerManaBonus-this.usedBonus;
      const discounted={...cost,generic:Math.max(0,cost.generic-bonus)};
      const selected=sourcePicks(sources,discounted);
      if(selected!==null)return {sources,selected,bonus:Math.min(bonus,cost.generic)};
    }
    const selected=sourcePicks(sources,cost);
    return selected===null?null:{sources,selected,bonus:0};
  }
  canCast(side,card,asCommander=false){
    if(this.winner)return false;
    if(isLand(card))return false;
    return !!this._canPay(side,card,asCommander?this.players[side].commanderTax:0);
  }
  _resolveSpell(side,card,target=null,commander=false) {
    const p=this.players[side],opponent=this.players[1-side],effect=textOf(card);
    const caster=side?'Opponent':'You';
    if(/\b(destroy all creatures|exile all creatures|each creature gets -[0-9])\b/.test(effect)) {
      let hits=0;
      for(const player of this.players)for(const obj of [...player.battlefield])if(isCreature(obj.card)){
        this._destroy(obj,player===p?side:1-side);hits++;
      }
      this._log(card.name+' clears '+hits+' simulated creatures.');
    } else if(/\b(destroy target|exile target|return target .+ to .+hand|deals? \d+ damage to target)\b/.test(effect)) {
      const choices=opponent.battlefield.filter(x=>!isLand(x.card));
      const selected=choices.find(x=>x.uid===target)||choices.sort((a,b)=>cardStrength(b.card)-cardStrength(a.card))[0];
      if(selected){
        this._destroy(selected,1-side);
        this._log(card.name+' removes '+selected.card.name+' (simplified targeting).');
      } else this._log(card.name+' has no eligible simulated opposing permanent.');
    }
    const draws=/draw (two|three|four) cards/.exec(effect);
    const drawOne=/draw a card/.test(effect);
    if(draws||drawOne){
      const count=draws?{two:2,three:3,four:4}[draws[1]]:1;
      this._draw(side,Math.min(count,4));
      this._log(caster+' draw '+count+' card(s).');
    }
    if(this.winner)return;
    if(/search your library for a basic land/.test(effect)) {
      const index=p.library.findIndex(x=>isLand(x)&&/\bBasic\b/.test(typeOf(x)));
      if(index!==-1){const [land]=p.library.splice(index,1);this._addPermanent(side,land,true);this._log(caster+' ramp a basic land tapped.');}
    }
    if(/\bcreate .* (?:creature|soldier|saproling|goblin|beast|human|spirit|zombie|elf|treasure) token/.test(effect)) {
      const isTreasure=effect.includes('treasure');
      const token={name:isTreasure?'Treasure token':card.name+' token',type:isTreasure?'Artifact':'Creature — Token',cmc:0,
        power:'1',toughness:'1',oracle_text:isTreasure?'{T}, Sacrifice this artifact: Add one mana of any color.':'',produced_mana:isTreasure?['W','U','B','R','G']:[]};
      this._addPermanent(side,token,false);
      this._log(card.name+' creates one representative '+(isTreasure?'Treasure':'creature')+' token.');
    }
    if(/\bgain [0-9]+ life/.test(effect)) {
      const n=Number((effect.match(/gain ([0-9]+) life/)||[])[1]||0);p.life+=atLeast(n,0,20);
    }
    // Non-permanents do not stay on the battlefield.
    if(isPermanent(card))this._addPermanent(side,card);
    else p.graveyard.push(card);
    if(commander)p.commanderInZone=false;
  }
  _destroy(obj,side){
    const p=this.players[side],index=p.battlefield.findIndex(x=>x.uid===obj.uid);
    if(index===-1)return;
    p.battlefield.splice(index,1);
    if(obj.commander){p.commanderInZone=true;p.commanderTax+=2;this._log(p.name+' returns to the command zone (tax +2).');}
    else p.graveyard.push(obj.card);
  }
  _cast(side,index,command=false,target=null) {
    const p=this.players[side];
    const card=command?p.commander:p.hand[index];
    if(!card||isLand(card)||command&&!p.commanderInZone)throw new DeckInputError('The chosen spell is unavailable.');
    const payment=this._canPay(side,card,command?p.commanderTax:0);
    if(!payment)throw new DeckInputError('Insufficient or incompatible untapped mana sources, or an unsupported mana cost.');
    for(const i of payment.selected)payment.sources[i].tapped=true;
    this.usedBonus+=payment.bonus;
    if(!command)p.hand.splice(index,1);
    this._log((side?'Opponent':'You')+' cast '+card.name+(command?' from the command zone':'')+'.');
    this._resolveSpell(side,card,target,command);
  }
  cast(index,target=null) {
    this._require('main');
    this._cast(0,index,false,target);
    return this.view();
  }
  castCommander(target=null){
    this._require('main');
    this._cast(0,-1,true,target);
    return this.view();
  }
  _attackers(side){
    return this.players[side].battlefield.filter(obj=>isCreature(obj.card)&&!obj.tapped&&
      (obj.enteredTurn!==this.players[side].turns||has(obj.card,'haste')));
  }
  _canBlock(attacker,defender){
    if(!isCreature(defender.card)||defender.tapped)return false;
    return !has(attacker.card,'flying') || has(defender.card,'flying')||has(defender.card,'reach');
  }
  beginCombat(ids=[]){
    this._require('main');
    if(this.humanAttacked)throw new DeckInputError('You have already attacked this turn.');
    const ready=this._attackers(0);
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw new DeckInputError('Choose distinct attackers.');
    const attackers=ids.map(id=>ready.find(obj=>obj.uid===id));
    if(attackers.some(x=>!x))throw new DeckInputError('One or more attackers are not ready.');
    this.humanAttacked=true;
    for(const obj of attackers)if(!has(obj.card,'vigilance'))obj.tapped=true;
    this._resolveCombat(0,attackers,this._botBlocks(attackers));
    return this.view();
  }
  _botBlocks(attackers){
    const blockers=this.players[1].battlefield.filter(x=>isCreature(x.card)&&!x.tapped);
    const used=new Set(),assign={};
    for(const attacker of [...attackers].sort((a,b)=>powered(b.card)-powered(a.card))){
      const possible=blockers.filter(blocker=>!used.has(blocker.uid)&&this._canBlock(attacker,blocker));
      if(!possible.length)continue;
      possible.sort((a,b)=>{
        const meetsA=toughness(a.card)>powered(attacker.card)?1:0;
        const meetsB=toughness(b.card)>powered(attacker.card)?1:0;
        return meetsB-meetsA||powered(b.card)-powered(a.card);
      });
      const selected=possible[0];assign[attacker.uid]=selected.uid;used.add(selected.uid);
    }
    return assign;
  }
  _resolveCombat(side,attackers,blocks) {
    const attacking=this.players[side],defending=this.players[1-side];
    const deadAttackers=new Set(),deadBlockers=new Set();
    let dealt=0;
    for(const a of attackers){
      const b=defending.battlefield.find(obj=>obj.uid===Number(blocks[a.uid]));
      const power=powered(a.card),aTough=toughness(a.card);
      if(b&&this._canBlock(a,b)){
        const bPower=powered(b.card),bTough=toughness(b.card);
        this._log(b.card.name+' blocks '+a.card.name+'.');
        if(power>=bTough||has(a.card,'deathtouch'))deadBlockers.add(b.uid);
        if(bPower>=aTough||has(b.card,'deathtouch'))deadAttackers.add(a.uid);
        if(has(a.card,'trample')&&power>bTough){const excess=power-bTough;dealt+=excess;
          if(a.commander)defending.commanderDamage+=excess;}
        if(has(a.card,'lifelink'))attacking.life+=power;
      }else{
        dealt+=power;
        if(a.commander)defending.commanderDamage+=power;
        if(has(a.card,'lifelink'))attacking.life+=power;
      }
    }
    defending.life-=dealt;
    for(const uid of deadAttackers){const obj=attacking.battlefield.find(x=>x.uid===uid);if(obj)this._destroy(obj,side);}
    for(const uid of deadBlockers){const obj=defending.battlefield.find(x=>x.uid===uid);if(obj)this._destroy(obj,1-side);}
    this._log((side?'Opponent':'You')+' deal '+dealt+' simplified combat damage.'+
      (deadAttackers.size||deadBlockers.size?' '+deadAttackers.size+' attacker(s) and '+deadBlockers.size+' blocker(s) die.':''));
    if(defending.commanderDamage>=21) this._endGame(side,'21 commander combat damage.');
    else if(defending.life<=0)this._endGame(side,'Opponent life reached zero.');
  }
  _endGame(winner,reason){this.winner=winner;this.phase='finished';this._log((winner===0?'You win!':'AI wins!')+' '+reason);}
  _botScore(card) {
    const t=textOf(card),enemy=this.players[0],bot=this.players[1];
    let score=Number(card.cmc||0)*.3;
    if(isCreature(card))score+=4+powered(card)*1.2;
    if(/draw (a|two|three) cards?/.test(t))score+=bot.hand.length<=3?9:4;
    if(/search your library for a basic land|add \{/.test(t))score+=bot.turns<=4?12:2;
    if(/destroy target|exile target/.test(t))score+=enemy.battlefield.some(o=>isCreature(o.card))?11:-5;
    if(/destroy all creatures/.test(t))score+=enemy.battlefield.length>bot.battlefield.length+1?18:-20;
    return score;
  }
  _botActionNeedsReview(card){
    // These simulated effects may alter the human's life, cards or battlefield.
    return /destroy target|exile target|return target|damage to target|destroy all creatures|exile all creatures|each creature|each opponent|target opponent|target player|deals? \d+ damage/i.test(textOf(card));
  }
  confirmAiAction(){
    this._require('confirm-ai');
    if(!this.pendingAi)throw new DeckInputError('There is no AI action to review.');
    const approved=this.pendingAi;
    this.pendingAi=null;this.phase='bot';
    this._log('You acknowledged AI action: '+approved.card.name+'.');
    this._botPlay(approved);
    return this.view();
  }
  _botPlay(approved=null){
    const bot=this.players[1];
    const lands=bot.hand.map((c,i)=>({c,i})).filter(x=>isLand(x.c));
    if(lands.length&&bot.landDrops===0){
      lands.sort((a,b)=>effectiveColors(b.c,bot.commander.color_identity).colors.length-
        effectiveColors(a.c,bot.commander.color_identity).colors.length);
      const chosen=lands[0];bot.hand.splice(chosen.i,1);bot.landDrops++;
      this._addPermanent(1,chosen.c);
      this._log('AI plays '+chosen.c.name+'.');
    }
    for(let plays=0;plays<8&&!this.winner;plays++){
      if(approved){
        this._cast(1,approved.index,approved.command);
        approved=null;
        if(this.winner)return;
        continue;
      }
      const options=bot.hand.map((c,i)=>({c,i,command:false}))
        .filter(x=>!isLand(x.c)&&this.canCast(1,x.c));
      if(bot.commanderInZone&&this.canCast(1,bot.commander,true))options.push({c:bot.commander,i:-1,command:true});
      if(!options.length)break;
      options.sort((a,b)=>this._botScore(b.c)-this._botScore(a.c));
      const choice=options[0];
      if(this._botActionNeedsReview(choice.c)){
        this.pendingAi={index:choice.i,command:choice.command,card:choice.c,
          description:'AI proposes to cast '+choice.c.name+
            '. This may affect your creatures, cards or life total. Review and acknowledge before it resolves.'};
        this.phase='confirm-ai';
        this._log('Waiting for your acknowledgement of '+choice.c.name+'.');
        return;
      }
      this._cast(1,choice.i,choice.command);
      if(this.winner)return;
    }
    const attackers=this._attackers(1);
    if(!attackers.length){this._finishBot();return;}
    for(const a of attackers)if(!has(a.card,'vigilance'))a.tapped=true;
    this.pendingAttack=attackers.map(x=>x.uid);
    this.attackOwner=1;this.phase='defend';
    this._log('AI attacks with '+attackers.map(x=>x.card.name).join(', ')+'. Choose your blockers.');
  }
  resolveDefense(blocks={}){
    this._require('defend');
    const attackers=this.pendingAttack.map(id=>this.players[1].battlefield.find(x=>x.uid===id)).filter(Boolean);
    const defenders=this.players[0].battlefield;
    const used=new Set(),legal={};
    for(const attacker of attackers){
      const block=Number(blocks[attacker.uid]||0);
      if(!block)continue;
      const defender=defenders.find(x=>x.uid===block);
      if(!defender||used.has(block)||!this._canBlock(attacker,defender))
        throw new DeckInputError('An invalid or repeated blocker was selected.');
      legal[attacker.uid]=block;used.add(block);
    }
    this._resolveCombat(1,attackers,legal);
    this.pendingAttack=[];
    if(!this.winner)this._finishBot();
    return this.view();
  }
  _finishBot(){
    this.round++;
    this.humanAttacked=false;
    this._startTurn(0);
  }
  endTurn(){
    this._require('main');
    this._log('You pass the turn.');
    this._startTurn(1);
    if(!this.winner)this._botPlay();
    return this.view();
  }
  view(){
    const players=this.players.map((p,i)=>({
      name:p.name,life:p.life,library:p.library.length,graveyard:p.graveyard.length,
      graveyardCards:p.graveyard.map(c=>({...c})),
      exileCards:(p.exile||[]).map(c=>({...c})),
      commandZoneCards:p.commanderInZone?[{...p.commander}]:[],
      handCount:p.hand.length,hand:i===0?p.hand.map(c=>({...c})):[],
      battlefield:p.battlefield.map(o=>({...o,card:{...o.card}})),
      commander:p.commander,commanderInZone:p.commanderInZone,commanderTax:p.commanderTax,
      commanderDamage:p.commanderDamage,landsPlayed:p.landDrops,
      manaAvailable:this._sources(i).length,readyAttackers:i===0?this._attackers(0).map(o=>o.uid):[],
      canCastCommander:i===0&&this.phase==='main'&&p.commanderInZone&&this.canCast(0,p.commander,true)
    }));
    return {phase:this.phase,winner:this.winner,round:this.round,log:this.log.slice(),
      players,attackers:this.pendingAttack.slice(),canMulligan:this.phase==='opening'&&(this.mulliganMode==='friendly'||this.players[0].mulligans<8),
      mulliganMode:this.mulliganMode,mulligans:this.players[0].mulligans,
      bottomRequired:this.phase==='bottom'?bottomRequired(this.mulliganMode,this.players[0].mulligans):0,
      humanAttacked:this.humanAttacked,
      pendingAi:this.pendingAi?{card:{...this.pendingAi.card},description:this.pendingAi.description}:null};
  }
}
