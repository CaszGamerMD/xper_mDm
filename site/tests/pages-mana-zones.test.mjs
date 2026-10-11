import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manaBalance,rateDeck,improveCards} from '../deck-doctor.mjs';
import {LiveDuel} from '../live-match.mjs';
import {RulesDuel} from '../rules-duel.mjs';

const white={name:'White Commander',commander:true,eligible:true,cmc:3,
 type_line:'Legendary Creature — Human',mana_cost:'{1}{W}{W}',color_identity:['W'],
 oracle_text:'',keywords:[],creature:true,land:false};
const mk=(name,type='Creature — Human',mana='{W}',extra={})=>({
 name,type_line:type,oracle_text:'',cmc:1,mana_cost:mana,color_identity:['W'],
 eligible:true,creature:type.includes('Creature'),land:type.includes('Land'),
 basic:type.includes('Basic'),quantity:1,keywords:[],produced_mana:[],image:'https://example.test/card.png',
 url:'https://example.test/card',...extra
});
const plains=mk('Plains','Basic Land — Plains','',{basic:true,produced_mana:['W']});
const wastes=mk('Wastes','Basic Land','',{basic:true,produced_mana:['C']});
const spells=Array.from({length:66},(_,i)=>mk('White Soldier '+i));
function deckCards(lands,nonlands=99-lands){
 return [...Array.from({length:lands},()=>({...plains})),...spells.slice(0,nonlands)];
}
const ctx={plan:null,tribes:[]};
test('Deck Doctor estimates colored mana by sources versus colored pip demand',()=>{
 const poor=[...Array.from({length:20},()=>plains),
   ...Array.from({length:17},()=>wastes),...spells.slice(0,62)];
 const rated=manaBalance(poor,white);
 assert.deepEqual(rated.colors,['W']);
 assert.equal(rated.sources.W,20);
 assert.ok(rated.score<.9);
 assert.ok(rated.warnings.length>0);
 const mono=manaBalance(deckCards(37),white);
 assert.ok(mono.score>.99);
});
test('underland decks can swap nonland spells for Plains until near target',()=>{
 const original=deckCards(33);
 const result=improveCards(original,white,[plains],{maxSwaps:4,context:ctx});
 assert.ok(result.swaps.length>=2);
 assert.ok(result.after.lands>33);
 assert.ok(result.after.score>result.before.score);
 assert.ok(result.swaps.every(x=>x.reason==='Land count correction'));
 assert.equal(result.cards.length,99);
 assert.equal(result.remaining,99-result.swaps.length);
});
test('color-balanced land swaps can improve the rating without changing land count',()=>{
 const original=[...Array.from({length:20},()=>plains),
   ...Array.from({length:17},()=>wastes),...spells.slice(0,62)];
 const result=improveCards(original,white,[plains],{maxSwaps:4,context:ctx});
 assert.ok(result.swaps.length>0);
 assert.equal(result.before.lands,result.after.lands);
 assert.ok(result.after.mana_balance.sources.W>result.before.mana_balance.sources.W);
 assert.ok(result.after.mana_balance.score>result.before.mana_balance.score);
 assert.ok(result.swaps.some(s=>s.reason==='Mana-color balancing'));
 assert.ok(result.swaps.every(s=>s.inCard.image && s.outCard.name));
});
test('three visible client pages and deck selector previews are present in built markup',()=>{
 const markup=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const id of ['page-generator','deck-doctor','playtest','play-deck-previews'])
   assert.ok(markup.includes('id="'+id+'"'));
 for(const name of ['generator','doctor','playtest'])
   assert.ok(markup.includes('data-page="'+name+'"'));
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/window\.addEventListener\('hashchange'/);
});
function gameDeck(commander='Frog King'){
 const frog=mk('Frog','Creature — Frog','{G}',{power:'2',toughness:'2',color_identity:['G']});
 const f=mk('Forest','Basic Land — Forest','',{basic:true,produced_mana:['G'],color_identity:['G']});
 return {total_cards:100,commander:mk(commander,'Legendary Creature — Frog','{G}{G}',{
  commander:true,color_identity:['G'],power:'2',toughness:'2',cmc:2}),
  groups:[{role:'lands',cards:[{...f,quantity:50}]},
    {role:'spells',cards:[{...frog,quantity:49}]}]};
}
test('quick AI targeting player battlefield pauses until acknowledged and zones are inspectable',()=>{
 const d=new LiveDuel(gameDeck(),gameDeck('Bot King'),{seed:24});d.keep();
 const victim=d._addPermanent(0,mk('Victim Frog','Creature — Frog','{G}',{power:'2',toughness:'2'}));
 const kill=mk('Assassinate','Sorcery','{1}{G}',{oracle_text:'Destroy target creature.',cmc:2});
 d.players[1].hand=[kill];
 const forest=mk('Forest','Basic Land — Forest','',{produced_mana:['G'],basic:true});
 d._addPermanent(1,forest);d._addPermanent(1,forest);
 d.endTurn();
 assert.equal(d.phase,'confirm-ai');
 assert.equal(d.view().pendingAi.card.name,'Assassinate');
 assert.ok(d.players[0].battlefield.some(x=>x.uid===victim.uid));
 d.phase='main';
 assert.throws(()=>d.confirmAiAction(),/not available/);
 d.phase='confirm-ai';
 d.confirmAiAction();
 assert.ok(!d.players[0].battlefield.some(x=>x.uid===victim.uid));
 assert.ok(d.view().players[0].graveyardCards.some(c=>c.name==='Victim Frog'));
 assert.equal(d.view().players[0].commandZoneCards.length,1);
});
test('strict AI spell review preserves priority and exile effects track the exile zone',()=>{
 const d=new RulesDuel(gameDeck(),gameDeck('Bot King'),{seed:18});d.keep();
 const forest=mk('Forest','Basic Land — Forest','',{produced_mana:['G'],basic:true});
 for(let i=0;i<4;i++)d._addPermanent(1,forest);
 const victim=d._addPermanent(0,mk('Human Frog','Creature — Frog','{G}',{power:'2',toughness:'2'}));
 const banish=mk('Banish Frog','Instant','{1}{G}',{oracle_text:'Exile target creature.',cmc:2});
 d.players[1].hand=[banish];
 d.endTurn();
 assert.equal(d.phase,'confirm-ai');
 d.confirmAiAction();
 assert.equal(d.phase,'respond');
 assert.equal(d.stack.length,1);
 assert.equal(d.players[0].battlefield.some(o=>o.uid===victim.uid),true);
 d.passPriority();
 assert.equal(d.view().players[0].exileCards.length,1);
 assert.equal(d.view().players[0].exileCards[0].name,'Human Frog');
 assert.equal(d.view().players[0].graveyardCards.length,0);
});
