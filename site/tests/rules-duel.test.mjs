import test from 'node:test';
import assert from 'node:assert/strict';
import {RulesDuel} from '../rules-duel.mjs';
import {supportInfo,supportedShare} from '../rules-kernel.mjs';
import {DeckInputError} from '../generator.mjs';

const card=(name,type='Creature — Bear',cmc=2,manaCost='{1}{G}',oracleText='',power='2',toughness='2')=>
 ({name,type,cmc,mana_cost:manaCost,oracle_text:oracleText,power,toughness,quantity:1,keywords:[],color_identity:['G']});
const forest=card('Forest','Basic Land — Forest',0,'','{T}: Add {G}.','','');
const island=card('Island','Basic Land — Island',0,'','{T}: Add {U}.','','');
const bear=card('Grizzly Bears','Creature — Bear',2,'{1}{G}','','2','2');
const frog=card('Test Frog','Creature — Frog',1,'{G}','','1','1');
const draw2=card('Divination','Sorcery',3,'{2}{U}','Draw two cards.');
const destroy=card('Clean Kill','Instant',2,'{1}{B}','Destroy target creature.');
const counter=card('Counterspell','Instant',2,'{U}{U}','Counter target spell.');
const brainstorm=card('Draw Now','Instant',1,'{U}','Draw a card.');
const complicated=card('Mage Engine','Creature — Wizard',3,'{2}{U}','Whenever this creature enters, draw a card.');
function deck(name='Test Commander'){
  return {total_cards:100,commander:card(name,'Legendary Creature — Bear',2,'{1}{G}','','2','2'),
    groups:[{role:'lands',cards:[{...forest,quantity:51},{...island,quantity:25}]},
      {role:'spells',cards:[{...bear,quantity:23}]}]};
}
const setup=(seed=22)=>{
  const d=new RulesDuel(deck('Human Commander'),deck('AI Commander'),{seed});
  d.keep();
  return d;
};
const land=(d,side,c,count=1)=>{for(let i=0;i<count;i++)d._addPermanent(side,{...c});};
test('Rules Lab parser explicitly accepts only implemented card text',()=>{
  assert.deepEqual(supportInfo(draw2),{supported:true,kind:'draw',amount:2});
  assert.equal(supportInfo(destroy).target,'creature');
  assert.equal(supportInfo(counter).target,'spell');
  assert.equal(supportInfo(brainstorm).kind,'draw');
  assert.equal(supportInfo(card('Flying Bear','Creature — Bear',2,'{1}{G}','Flying, vigilance')).supported,true);
  assert.equal(supportInfo(complicated).supported,false);
  assert.equal(supportInfo(card('Overcomplicated Land','Land',0,'','Whenever a creature enters, create a token.')).supported,false);
  const report=supportedShare(deck());
  assert.equal(report.total,99);
  assert.equal(report.percentage,100);
});
test('unsupported engine cards are disabled, not falsely executed',()=>{
  const d=setup();land(d,0,island,5);d.players[0].hand.push(complicated);
  assert.equal(d.canCast(0,complicated),false);
  assert.throws(()=>d.cast(d.players[0].hand.length-1),/cannot legally be cast/);
  assert.equal(d.stack.length,0);
});
test('spells stay on stack until priority pass, then LIFO resolve',()=>{
  const d=setup();land(d,0,island,3);
  d.players[0].hand.push(draw2,brainstorm);
  const old=d.players[0].hand.length;
  d.cast(old-2);
  assert.equal(d.stack.length,1);assert.equal(d.phase,'respond');
  assert.equal(d.players[0].hand.length,old-1);
  assert.throws(()=>d.playLand(0),/stack/);
  const index=d.players[0].hand.findIndex(c=>c.name==='Draw Now');
  d.cast(index);
  assert.equal(d.stack.length,2);
  d.passPriority();
  assert.equal(d.stack.length,1);assert.equal(d.phase,'respond');
  assert.equal(d.players[0].hand.length,old-2+1);
  d.passPriority();
  assert.equal(d.stack.length,0);assert.equal(d.phase,'main');
  assert.equal(d.players[0].hand.length,old-2+3);
});
test('counterspell stays on top, then counters the original spell',()=>{
  const d=setup();land(d,0,island,3);land(d,1,island,3);
  d.players[0].hand.push(draw2);d.players[1].hand.push(counter);
  const index=d.players[0].hand.findIndex(c=>c.name==='Divination');
  d.cast(index);
  assert.equal(d.stack.at(-1).card.name,'Divination');
  d.passPriority();
  assert.equal(d.stack.length,2);
  assert.equal(d.stack.at(-1).card.name,'Counterspell');
  d.passPriority();
  assert.equal(d.stack.length,0);
  assert.equal(d.players[0].graveyard.at(-1).name,'Divination');
  assert.equal(d.players[1].graveyard.at(-1).name,'Counterspell');
  assert.ok(d.log.some(x=>x.includes('counters Divination')));
});
test('permanents enter after spell resolves and commander tax counts casts, not deaths',()=>{
  const d=setup();land(d,0,forest,3);
  d.players[0].hand.push(bear);
  d.cast(d.players[0].hand.length-1);
  assert.equal(d.players[0].battlefield.filter(o=>o.card.name==='Grizzly Bears').length,0);
  d.passPriority();
  assert.equal(d.players[0].battlefield.filter(o=>o.card.name==='Grizzly Bears').length,1);
  d.castCommander();
  assert.equal(d.players[0].commanderTax,2);
  d.passPriority();
  const commander=d.players[0].battlefield.find(o=>o.commander);
  d._destroy(commander,0);
  assert.equal(d.players[0].commanderTax,2);
  assert.equal(d.players[0].commanderInZone,true);
});
test('targeted creature removal waits until resolution and respects indestructible',()=>{
  const d=setup();land(d,0,island,3);land(d,0,card('Swamp','Basic Land — Swamp',0,'','{T}: Add {B}.'),2);
  const victim=d._addPermanent(1,bear);
  d.players[0].hand.push(destroy);
  d.cast(d.players[0].hand.length-1,victim.uid);
  assert.equal(d.players[1].battlefield.length,1);
  d.passPriority();
  assert.equal(d.players[1].battlefield.length,0);
});
test('target selection rejects nonexistent creature and cannot spend tapped mana twice',()=>{
  const d=setup();land(d,0,island,1);
  d.players[0].hand.push(brainstorm,brainstorm);
  d.cast(d.players[0].hand.length-1);
  assert.equal(d.canCast(0,brainstorm),false);
  d.passPriority();
  assert.equal(d.canCast(0,brainstorm),false);
});
test('first strike kills the blocker before normal damage, with no illegal damage to player',()=>{
  const d=setup();
  const attacker=d._addPermanent(0,card('First Striker','Creature — Bear',2,'{1}{G}','First strike','3','2'));
  attacker.enteredTurn=0;
  const blocker=d._addPermanent(1,card('Big Blocker','Creature — Bear',4,'{3}{G}','','2','2'));
  d._resolveCombat(0,[attacker],{[attacker.uid]:blocker.uid});
  assert.equal(d.players[1].battlefield.some(x=>x.uid===blocker.uid),false);
  assert.equal(d.players[0].battlefield.some(x=>x.uid===attacker.uid),true);
  assert.equal(d.players[1].life,40);
});
test('simultaneous combat kills both 2/2 creatures and a blocked nontrampler deals no life damage',()=>{
  const d=setup();
  const attacker=d._addPermanent(0,bear),blocker=d._addPermanent(1,bear);
  attacker.enteredTurn=0;
  d._resolveCombat(0,[attacker],{[attacker.uid]:blocker.uid});
  assert.equal(d.players[0].battlefield.filter(x=>x.uid===attacker.uid).length,0);
  assert.equal(d.players[1].battlefield.filter(x=>x.uid===blocker.uid).length,0);
  assert.equal(d.players[1].life,40);
});
test('bot puts its spell on the stack and grants the human a response',()=>{
  const d=setup();d.players[1].hand=[bear];land(d,1,forest,3);
  d.endTurn();
  assert.equal(d.phase,'respond');
  assert.equal(d.stack.at(-1).side,1);
  const before=d.players[1].battlefield.length;
  d.passPriority();
  assert.equal(d.players[1].battlefield.length,before+1);
});
test('defender creatures cannot be declared as attackers',()=>{
  const d=setup();
  const a=d._addPermanent(0,card('Wall','Creature — Wall',2,'{1}{G}','Defender','0','4'));
  a.enteredTurn=0;
  assert.equal(d._attackers(0).some(o=>o.uid===a.uid),false);
  assert.throws(()=>d.beginCombat([a.uid]),/not ready/);
});
test('Rules Lab exposes coverage and detailed stack state to the UI',()=>{
  const d=setup();assert.equal(d.view().rulesLab,true);
  assert.equal(d.view().coverage.length,2);
  land(d,0,island);d.players[0].hand.push(brainstorm);
  d.cast(d.players[0].hand.length-1);
  assert.equal(d.view().stack[0].name,'Draw Now');
});
