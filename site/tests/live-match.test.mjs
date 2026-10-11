import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveDuel,expandMain,manaSource} from '../live-match.mjs';

function card(name,type,cmc=0,manaCost='',oracleText='',power='',toughness=''){
  return {name,type,cmc,mana_cost:manaCost,oracle_text:oracleText,power,toughness,quantity:1,
    produced_mana:[],color_identity:['G'],keywords:[]};
}
const forest=card('Forest','Basic Land — Forest',0,'','{T}: Add {G}.');
const frog=card('Green Frog','Creature — Frog',1,'{G}','','1','1');
const botFrog=card('Bot Frog','Creature — Frog',1,'{G}','','1','1');
function deck(commander='Frog King',frogCard=frog){
  return {total_cards:100,commander:card(commander,'Legendary Creature — Frog',2,'{G}{G}','','2','2'),
    groups:[{role:'lands',cards:[{...forest,quantity:55}]},
      {role:'creatures',cards:[{...frogCard,quantity:44}]}]};
}
test('mana sources respect colors and untapped generic costs',()=>{
  assert.deepEqual(manaSource(forest,['G']).colors,['G']);
  assert.deepEqual(manaSource(card('Sol Ring','Artifact',1,'{1}','{T}: Add {C}{C}.'),['G']),
    {colors:['C'],amount:2});
});
test('mulligan, keep and land per turn have enforced phase restrictions',()=>{
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:3});
  assert.equal(game.view().phase,'opening');
  game.mulligan();assert.equal(game.view().canMulligan,false);
  assert.throws(()=>game.mulligan(),/one free mulligan/i);
  game.keep();
  assert.equal(game.view().phase,'main');
  let index=game.players[0].hand.findIndex(c=>c.name==='Forest');
  assert.ok(index>=0);
  game.playLand(index);
  index=game.players[0].hand.findIndex(c=>c.name==='Forest');
  assert.throws(()=>game.playLand(index),/already played/);
  assert.equal(game.players[0].battlefield.length,1);
});
test('human casts real cards from hand and tapping mana prevents duplicate spending',()=>{
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:4});
  game.keep();
  const hand=game.players[0].hand;
  const landIndex=hand.findIndex(c=>c.name==='Forest');
  game.playLand(landIndex);
  const spellIndex=game.players[0].hand.findIndex(c=>c.name==='Green Frog');
  assert.ok(spellIndex>=0);
  assert.equal(game.canCast(0,game.players[0].hand[spellIndex]),true);
  game.cast(spellIndex);
  assert.equal(game.players[0].battlefield.filter(x=>x.card.name==='Green Frog').length,1);
  assert.ok(game.players[0].battlefield.some(x=>x.card.name==='Forest'&&x.tapped));
  assert.equal(game.canCast(0,frog),false);
});
test('human chooses attackers, then AI chooses blocks; combat changes real board/life',()=>{
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:11});game.keep();
  const human=game._addPermanent(0,card('Ready Big Frog','Creature — Frog',3,'{2}{G}','','5','5'));
  // A ready, untapped permanent that arrived a previous turn.
  human.enteredTurn=0;
  game.players[1].battlefield=[];
  const before=game.players[1].life;
  game.beginCombat([human.uid]);
  assert.equal(game.players[1].life,before-5);
  assert.equal(game.view().humanAttacked,true);
  assert.throws(()=>game.beginCombat([]),/already attacked/);
});
test('AI takes turns; human receives explicit blocking choices',()=>{
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:23});game.keep();
  const ready=game._addPermanent(1,card('Ready Enemy','Creature — Frog',2,'{G}','','3','3'));
  ready.enteredTurn=0;
  const before=game.players[0].life;
  game.endTurn();
  assert.equal(game.view().phase,'defend');
  assert.equal(game.view().attackers.includes(ready.uid),true);
  game.resolveDefense({});
  assert.equal(game.players[0].life,before-3);
  assert.equal(game.view().phase,'main');
});
test('commander damage is tracked and can end a game',()=>{
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:1});game.keep();
  const object=game._addPermanent(0,game.players[0].commander);object.enteredTurn=0;
  object.card.power='21';
  game.beginCombat([object.uid]);
  assert.equal(game.winner,0);
  assert.equal(game.view().phase,'finished');
});
test('decks must be complete and missing colors prevent spells',()=>{
  assert.equal(expandMain(deck()).length,99);
  assert.throws(()=>expandMain({...deck(),total_cards:98}),/100-card/);
  const game=new LiveDuel(deck(),deck('Bot King',botFrog),{seed:55});game.keep();
  game._addPermanent(0,forest);
  assert.equal(game.canCast(0,card('Blue Frog','Creature — Frog',1,'{U}')),false);
});
