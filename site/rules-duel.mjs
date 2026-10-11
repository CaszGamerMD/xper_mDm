/** Rules Lab milestone: explicit stack, priority for spell responses, LIFO resolution,
 * checked spell effects and simultaneous combat damage for a deliberately narrow subset.
 * Outside that subset spells are disabled, NOT silently approximated.
 */
import {LiveDuel} from './live-match.mjs';
import {DeckInputError} from './generator.mjs';
import {supportInfo,supportedShare,isLand,isCreature,isInstant,isPermanent,hasAbility} from './rules-kernel.mjs';

const power=c=>{const n=Number(c.power);return Number.isFinite(n)?n:Math.max(1,Math.round((Number(c.cmc)||2)*.6));};
const tough=c=>{const n=Number(c.toughness);return Number.isFinite(n)?Math.max(1,n):Math.max(1,Math.round((Number(c.cmc)||2)*.6));};
const damageable=o=>o && isCreature(o.card);
export class RulesDuel extends LiveDuel {
  constructor(mine,opponent,options={}) {
    super(mine,opponent,options);
    this.coverage=[supportedShare(mine),supportedShare(opponent)];
    this.stack=[];this.activeSide=0;this.step='precombat';
    this.log=['Rules Lab enabled. Unsupported Oracle effects cannot be cast.',
      'Implemented: spell stack with response windows, simple costs, basic creatures, removal, draw, counterspells, and simultaneous combat damage.',
      'Missing: many triggered/activated/replacement effects, variable costs, full priority and multiple-blocker decisions.'];
  }
  _startTurn(side,opening=false){
    for(const p of this.players)for(const obj of p.battlefield)obj.damage=0;
    super._startTurn(side,opening);
    this.activeSide=side;this.step='precombat';
  }
  _destroy(object,side){
    const p=this.players[side];
    if(!p.battlefield.some(x=>x.uid===object.uid))return;
    // Casting, not returning to the command zone, creates commander tax.
    const tax=p.commanderTax;
    super._destroy(object,side);
    p.commanderTax=tax;
  }
  _eligibleTargets(side,info){
    if(info.target==='spell')return this.stack.map(x=>({uid:x.id,label:x.card.name,kind:'spell'}));
    if(info.target==='player')return [{uid:-1,label:this.players[1-side].name,kind:'player'}];
    if(info.target==='creature'){
      return this.players.flatMap((p,i)=>p.battlefield.filter(o=>damageable(o)&&
        !(i!==side&&hasAbility(o.card,'hexproof'))).map(o=>({uid:o.uid,label:o.card.name,kind:'permanent'})));
    }
    if(info.target==='any'){
      return [{uid:-1,label:this.players[1-side].name,kind:'player'},
        ...this._eligibleTargets(side,{target:'creature'})];
    }
    return [];
  }
  availableTargets(card,side=0){return this._eligibleTargets(side,supportInfo(card));}
  canCast(side,card,asCommander=false){
    if(!supportInfo(card).supported || isLand(card))return false;
    if(!super.canCast(side,card,asCommander))return false;
    if(asCommander && !this.players[side].commanderInZone)return false;
    if(!isInstant(card) && (this.stack.length|| (side===0 && this.phase!=='main')||
      (side===1 && this.phase!=='bot')))return false;
    if(side===0 && !['main','respond'].includes(this.phase))return false;
    if(side===1 && this.phase!=='bot' && !this.stack.length)return false;
    const info=supportInfo(card);
    if(info.target && !this._eligibleTargets(side,info).length)return false;
    return true;
  }
  _queue(side,index,commander=false,target=null) {
    const p=this.players[side],card=commander?p.commander:p.hand[index];
    if(!card || !this.canCast(side,card,commander)) throw new DeckInputError('This spell cannot legally be cast in the Rules Lab window. Unsupported effects are disabled.');
    const info=supportInfo(card);
    const legal=this._eligibleTargets(side,info);
    let chosen=null;
    if(info.target){
      chosen=target===null?legal[0]?.uid:Number(target);
      if(!legal.some(o=>o.uid===chosen))throw new DeckInputError('Target is not legal for '+card.name+'.');
    }
    const payment=this._canPay(side,card,commander?p.commanderTax:0);
    if(!payment)throw new DeckInputError('Not enough untapped mana.');
    for(const sourceIndex of payment.selected)payment.sources[sourceIndex].tapped=true;
    if(!commander)p.hand.splice(index,1);
    else {p.commanderInZone=false;p.commanderTax+=2;}
    const spell={id:this._id(),card,side,commander,target:chosen,kind:info.kind,responded:false};
    this.stack.push(spell);this.phase='respond';
    this._log((side?'AI':'You')+' put '+card.name+' onto the stack'+(chosen!==null?' (target '+chosen+')':'')+'.');
    return spell;
  }
  cast(index,target=null){this._require('main','respond');this._queue(0,index,false,target);return this.view();}
  castCommander(target=null){this._require('main','respond');this._queue(0,-1,true,target);return this.view();}
  playLand(index){
    const card=this.players[0].hand[index];
    if(card&&isLand(card)&&!supportInfo(card).supported)throw new DeckInputError('This complex land cannot be played in strict Rules Lab yet.');
    if(this.stack.length)throw new DeckInputError('Land plays are sorcery-speed actions and cannot occur with spells on the stack.');
    return super.playLand(index);
  }
  _fizzle(spell,reason){
    this._log(spell.card.name+' has no effect: '+reason+'.');
    this._afterSpell(spell);
  }
  _afterSpell(spell) {
    const p=this.players[spell.side];
    if(spell.commander){
      p.commanderInZone=true; // If countered, owner chooses command zone rather than graveyard.
    } else p.graveyard.push(spell.card);
  }
  _resolveTop(){
    const spell=this.stack.pop();
    if(!spell)return;
    const {card,side,kind,target}=spell,owner=this.players[side];
    const info=supportInfo(card);
    this._log('Resolving '+card.name+'.');
    if(info.target && info.target!=='spell' && info.target!=='player'){
      const valid=this._eligibleTargets(side,info).some(o=>o.uid===target);
      if(!valid){this._fizzle(spell,'its target is no longer legal');return;}
    }
    if(kind==='counter'){
      const index=this.stack.findIndex(o=>o.id===target);
      if(index<0){this._fizzle(spell,'target spell left the stack');return;}
      const [removed]=this.stack.splice(index,1);
      this._log(card.name+' counters '+removed.card.name+'.');
      this._afterSpell(removed);
    }else if(kind==='draw'){
      this._draw(side,info.amount);
    }else if(kind==='gain'){
      owner.life+=info.amount;
    }else if(['destroy','exile','bounce'].includes(kind)){
      for(let player=0;player<2;player++){
        const obj=this.players[player].battlefield.find(o=>o.uid===target);
        if(!obj)continue;
        if(kind==='destroy'&&hasAbility(obj.card,'indestructible'))this._log(obj.card.name+' is indestructible.');
        else if(kind==='bounce') {
          this.players[player].battlefield=this.players[player].battlefield.filter(o=>o.uid!==obj.uid);
          if(obj.commander)this.players[player].commanderInZone=true;
          else this.players[player].hand.push(obj.card);
          this._log(obj.card.name+' returns to hand.');
        }else if(kind==='exile'){
          this.players[player].battlefield=this.players[player].battlefield.filter(o=>o.uid!==obj.uid);
          if(obj.commander)this.players[player].commanderInZone=true;
          this._log(obj.card.name+' is exiled (commanders return to command zone).');
        }else this._destroy(obj,player);
        break;
      }
    }else if(kind==='damage'){
      if(target===-1){this.players[1-side].life-=info.amount;}
      else for(const p of this.players){
        const obj=p.battlefield.find(o=>o.uid===target);
        if(obj){obj.damage=(obj.damage||0)+info.amount;break;}
      }
    }
    if(isPermanent(card))this._addPermanent(side,card);
    else owner.graveyard.push(card);
    this._stateActions();
  }
  _stateActions(){
    for(let i=0;i<2;i++){
      for(const object of [...this.players[i].battlefield]) {
        if(isCreature(object.card) && (object.damage||0)>=tough(object.card) &&
          !hasAbility(object.card,'indestructible'))this._destroy(object,i);
      }
    }
    for(let i=0;i<2;i++){
      if(this.players[i].life<=0 || this.players[i].commanderDamage>=21){
        this._endGame(1-i,'A state-based game-ending condition was met.');
        break;
      }
    }
  }
  _botCounter(){
    const top=this.stack.at(-1);
    if(!top||top.side!==0||top.responded)return false;
    top.responded=true;
    const bot=this.players[1];
    const index=bot.hand.findIndex(c=>supportInfo(c).kind==='counter'&&this.canCast(1,c));
    if(index<0)return false;
    const response=bot.hand[index];
    this._log('AI holds priority to counter '+top.card.name+'.');
    this._queue(1,index,false,top.id);
    return true;
  }
  passPriority(){
    this._require('main','respond');
    if(!this.stack.length)throw new DeckInputError('The stack is empty. Play, attack, or end your turn.');
    if(this._botCounter())return this.view();
    this._resolveTop();
    if(this.winner)return this.view();
    if(this.stack.length)this.phase='respond';
    else if(this.activeSide===0)this.phase='main';
    else {this.phase='bot';this._botNext();}
    return this.view();
  }
  _attackers(side){return super._attackers(side).filter(o=>!hasAbility(o.card,'defender'));}
  beginCombat(ids=[]){
    if(this.stack.length)throw new DeckInputError('Finish resolving the stack before declaring attackers.');
    const result=super.beginCombat(ids);
    this.step='postcombat';
    return this.view();
  }
  _resolveCombat(side,attackers,blocks){
    const defending=this.players[1-side],attacking=this.players[side];
    const pairs=attackers.map(a=>({a,b:defending.battlefield.find(x=>x.uid===Number(blocks[a.uid]))||null}));
    const apply=(firstStep)=>{
      const playerDmg=new Map(),creatureDamage=new Map(),deathTouch=new Set();
      for(const {a,b} of pairs){
        if(!attacking.battlefield.some(x=>x.uid===a.uid))continue;
        const first=hasAbility(a.card,'first strike'),double=hasAbility(a.card,'double strike');
        if(firstStep?!(first||double):first&&!double)continue;
        const val=Math.max(0,power(a.card));
        if(b){
          // Blocked remains blocked if its blocker left in an earlier combat step.
          if(defending.battlefield.some(x=>x.uid===b.uid)){
            const excess=hasAbility(a.card,'trample')?Math.max(0,val-Math.max(0,tough(b.card)-(b.damage||0))):0;
            creatureDamage.set(b.uid,(creatureDamage.get(b.uid)||0)+val-excess);
            if(excess)playerDmg.set(1-side,(playerDmg.get(1-side)||0)+excess);
            if(val>0&&hasAbility(a.card,'deathtouch'))deathTouch.add(b.uid);
            if(hasAbility(a.card,'lifelink'))attacking.life+=val;
            if(a.commander&&excess)defending.commanderDamage+=excess;
          }else if(hasAbility(a.card,'trample')){
            playerDmg.set(1-side,(playerDmg.get(1-side)||0)+val);
            if(hasAbility(a.card,'lifelink'))attacking.life+=val;
            if(a.commander)defending.commanderDamage+=val;
          }
        }else{
          playerDmg.set(1-side,(playerDmg.get(1-side)||0)+val);
          if(a.commander)defending.commanderDamage+=val;
          if(hasAbility(a.card,'lifelink'))attacking.life+=val;
        }
      }
      for(const {a,b} of pairs){
        if(!b||!defending.battlefield.some(x=>x.uid===b.uid)||!attacking.battlefield.some(x=>x.uid===a.uid))continue;
        const first=hasAbility(b.card,'first strike'),double=hasAbility(b.card,'double strike');
        if(firstStep?!(first||double):first&&!double)continue;
        const val=Math.max(0,power(b.card));
        creatureDamage.set(a.uid,(creatureDamage.get(a.uid)||0)+val);
        if(val>0&&hasAbility(b.card,'deathtouch'))deathTouch.add(a.uid);
        if(hasAbility(b.card,'lifelink'))defending.life+=val;
      }
      for(const [uid,d] of creatureDamage)
        for(const p of this.players){const obj=p.battlefield.find(x=>x.uid===uid);if(obj)obj.damage=(obj.damage||0)+d;}
      for(const [player,d] of playerDmg){this.players[player].life-=d;this._log((side?'AI':'You')+' deal '+d+' combat damage.');}
      for(const uid of deathTouch){
        for(let p=0;p<2;p++){
          const obj=this.players[p].battlefield.find(x=>x.uid===uid);
          if(obj && !hasAbility(obj.card,'indestructible'))this._destroy(obj,p);
        }
      }
      this._stateActions();
    };
    const hasFirst=pairs.some(({a,b})=>[a,b].some(o=>o&&(hasAbility(o.card,'first strike')||hasAbility(o.card,'double strike'))));
    if(hasFirst)apply(true);
    if(!this.winner)apply(false);
  }
  _botNext(){
    if(this.winner)return;
    const bot=this.players[1];
    if(bot.landDrops===0){
      const i=bot.hand.findIndex(c=>isLand(c)&&supportInfo(c).supported);
      if(i>=0){
        const [land]=bot.hand.splice(i,1);bot.landDrops++;
        this._addPermanent(1,land);this._log('AI plays '+land.name+'.');
      }
    }
    const choices=bot.hand.map((card,index)=>({card,index,commander:false}))
      .filter(o=>this.canCast(1,o.card));
    if(bot.commanderInZone&&this.canCast(1,bot.commander,true))
      choices.push({card:bot.commander,index:-1,commander:true});
    choices.sort((a,b)=>(Number(b.card.cmc)||0)-(Number(a.card.cmc)||0));
    if(choices.length){
      const c=choices[0];this._queue(1,c.index,c.commander);
      this.phase='respond';this._log('You may respond with an instant, or pass to resolve.');
      return;
    }
    const attackers=this._attackers(1).filter(o=>!hasAbility(o.card,'defender'));
    if(!attackers.length){this._finishBot();return;}
    for(const a of attackers)if(!hasAbility(a.card,'vigilance'))a.tapped=true;
    this.pendingAttack=attackers.map(o=>o.uid);
    this.phase='defend';
    this._log('AI attacks with '+attackers.map(x=>x.card.name).join(', ')+'.');
  }
  _botPlay(){this._botNext();}
  endTurn(){
    if(this.stack.length)throw new DeckInputError('The stack must resolve before ending your turn.');
    return super.endTurn();
  }
  view(){
    const base=super.view();
    return {...base,rulesLab:true,stack:(this.stack||[]).map(o=>({id:o.id,name:o.card.name,side:o.side,
      target:o.target,kind:o.kind})),step:this.step||'precombat',activeSide:this.activeSide||0,
      coverage:this.coverage||null};
  }
}
