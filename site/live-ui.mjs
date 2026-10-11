/** Local-only human-vs-bot battlefield interface. */
import {LiveDuel} from './live-match.mjs';
import {RulesDuel} from './rules-duel.mjs';
import {supportInfo} from './rules-kernel.mjs';
const node=(tag,cls='',text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const btn=(label,fn,secondary=false)=>{const b=node('button','action'+(secondary?' secondary':''),label);b.type='button';b.addEventListener('click',fn);return b;};
const art=(card,cls)=>{
  const box=node('div',cls);
  if(card.image){const img=node('img');img.src=card.image;img.alt=card.name;img.loading='lazy';box.append(img);}
  else box.append(node('span','duel-fallback',card.name));
  return box;
};
const desc=c=>c.name+' · MV '+(Number(c.cmc)||0)+(c.power&&c.toughness?' · '+c.power+'/'+c.toughness:'');
const isLand=c=>/\bLand\b/.test(String(c.type||'').split(' — ')[0]);
export function mountLiveArena({mySelect,opponentSelect,resolveDeck}) {
  const stage=document.getElementById('live-game');
  const launch=document.getElementById('play-live');
  const launchRules=document.getElementById('play-rules');
  let duel=null,chosen=new Set(),error='';
  const safe=fn=>()=>{try{fn();error='';render();}catch(e){error=e.message||'Action was not allowed.';render();}};
  function field(player,mine,phase) {
    const box=node('section','duel-field');
    const header=node('div','duel-player-title');
    header.append(node('strong','',(mine?'YOU · ':'AI · ')+player.name),
      node('span','duel-life','♥ '+player.life),
      node('span','','Library '+player.library+' · Hand '+player.handCount+' · Graveyard '+player.graveyard));
    box.append(header);
    const board=node('div','duel-battlefield');
    if(!player.battlefield.length)board.append(node('p','duel-empty','Battlefield is empty.'));
    for(const obj of player.battlefield) {
      const tile=node('div','duel-permanent'+(obj.tapped?' is-tapped':''));
      const icon=art(obj.card,'duel-permanent-art');icon.title=desc(obj.card);
      tile.append(icon,node('span','duel-permanent-label',obj.card.name+(obj.tapped?' · tapped':'')));
      if(mine&&phase==='main'&&!duel.humanAttacked&&player.readyAttackers.includes(obj.uid)){
        const check=node('label','duel-check');const input=node('input');input.type='checkbox';
        input.checked=chosen.has(obj.uid);
        input.addEventListener('change',()=>input.checked?chosen.add(obj.uid):chosen.delete(obj.uid));
        check.append(input,document.createTextNode(' Attack'));tile.append(check);
      }
      board.append(tile);
    }
    box.append(board);return box;
  }
  function handView(state) {
    const you=state.players[0],box=node('section','duel-hand');
    box.append(node('h4','','Your hand · '+you.handCount+' cards'));
    const grid=node('div','duel-hand-grid');
    you.hand.forEach((card,index)=>{
      const tile=node('div','duel-hand-card');
      tile.append(art(card,'duel-card'),node('div','duel-hand-label',desc(card)));
      if(state.phase==='main'||state.phase==='respond'){
        const land=isLand(card),ok=state.phase==='main'&&land?you.landsPlayed<1:!land&&duel.canCast(0,card);
        let select=null;
        const targets=state.rulesLab ? duel.availableTargets(card) : state.players[1].battlefield.filter(x=>!isLand(x.card));
        if(!land&&ok&&(state.rulesLab ? Boolean(supportInfo(card).target) : /destroy target|exile target|return target|damage to target/i.test(card.oracle_text||''))&&targets.length){
          select=node('select','duel-target');
          targets.forEach(x=>{const opt=node('option','',x.label||x.card?.name||'Opponent player');opt.value=x.uid;select.append(opt);});
          tile.append(select);
        }
        const action=btn(land?'Play land':'Cast spell',safe(()=>{
          if(land)duel.playLand(index);
          else duel.cast(index,select?Number(select.value):null);
        }));
        action.disabled=!ok;
        if(state.rulesLab && !land && !supportInfo(card).supported)tile.append(node('small','duel-unsupported','Not implemented: '+supportInfo(card).reason));
        tile.append(action);
      }
      grid.append(tile);
    });
    box.append(grid);return box;
  }
  function toolbar(state){
    const box=node('div','duel-controls'),you=state.players[0];
    if(state.phase==='opening'){
      box.append(node('p','duel-instruction','Choose your opening hand. One free seven-card mulligan is available.'));
      box.append(btn('Keep hand',safe(()=>duel.keep())));
      const m=btn('Free mulligan',safe(()=>duel.mulligan()),true);m.disabled=!state.canMulligan;box.append(m);
    }else if(state.phase==='main'||state.phase==='respond'){
      const resolving=state.rulesLab&&state.stack.length>0;
      box.append(node('p','duel-instruction',resolving?'Priority window: cast a supported instant in response or pass to resolve the top spell.':
        'Your '+(state.rulesLab&&state.step==='postcombat'?'postcombat':'precombat')+' main phase · play one land, cast spells and select ready attackers.'));
      if(you.commanderInZone){
        const commander=btn('Cast commander (tax '+you.commanderTax+')',safe(()=>duel.castCommander()),true);
        commander.disabled=!you.canCastCommander;box.append(commander);
      }
      if(state.phase==='main'&&!state.humanAttacked)box.append(btn('Attack with selected',safe(()=>{
        duel.beginCombat([...chosen]);chosen=new Set();
      })));
      if(resolving)box.append(btn('Pass priority / Resolve stack',safe(()=>duel.passPriority()),true));
      else box.append(btn('End turn → AI plays',safe(()=>{chosen=new Set();duel.endTurn();}),true));
    }else if(state.phase==='defend'){
      box.append(node('p','duel-instruction','AI attacks! Pick a unique untapped blocker for each attacker or leave it unblocked.'));
      const blockers=you.battlefield.filter(x=>/\bCreature\b/.test(String(x.card.type).split(' — ')[0])&&!x.tapped);
      const assignments={};const pairs=node('div','duel-block-pairs');
      for(const uid of state.attackers){
        const attacker=state.players[1].battlefield.find(x=>x.uid===uid);if(!attacker)continue;
        const label=node('label','',attacker.card.name+' attacks ('+(attacker.card.power||'?')+' power)');
        const select=node('select','duel-target');
        const none=node('option','','Do not block');none.value='';select.append(none);
        for(const x of blockers) {
          if(/\bflying\b/i.test(attacker.card.oracle_text||'')&&!/\b(flying|reach)\b/i.test(x.card.oracle_text||''))continue;
          const option=node('option','',x.card.name+' · '+(x.card.power||'?')+'/'+(x.card.toughness||'?'));
          option.value=x.uid;select.append(option);
        }
        select.addEventListener('change',()=>{assignments[uid]=Number(select.value)||0;});
        label.append(select);pairs.append(label);
      }
      box.append(pairs,btn('Confirm blocks and resolve combat',safe(()=>{duel.resolveDefense(assignments);chosen=new Set();})));
    }else if(state.phase==='finished'){
      box.append(node('h3','',state.winner===0?'You win!':'AI wins!'));
      box.append(btn('Restart duel',safe(()=>{
        const decks=duel.originalDecks;duel=new duel.constructor(decks[0],decks[1],{seed:Date.now()});
        duel.originalDecks=decks;chosen=new Set();
      })));
    }
    return box;
  }
  function render(){
    stage.replaceChildren();
    if(!duel){stage.append(node('p','hint','Choose a player deck and a saved opponent, then select Play live.'));return;}
    const state=duel.view();
    const heading=node('div','duel-heading');
    heading.append(node('h3','','Interactive duel · round '+state.round),
      node('span','duel-phase',({opening:'Opening hand',main:'Your main phase',respond:'Respond / stack',defend:'Declare blockers',finished:'Finished'})[state.phase]||state.phase));
    stage.append(heading);
    if(state.rulesLab){
      const coverage=node('div','duel-coverage');
      const [yours,opponent]=state.coverage;
      coverage.append(node('span','', 'Rules Lab · your cards supported: '+yours.percentage+'%'+(yours.commanderSupported?'':' · commander unsupported')),
        node('span','','AI cards supported: '+opponent.percentage+'%'));
      stage.append(coverage);
      if(state.stack.length){
        const stack=node('div','duel-stack');stack.append(node('strong','','Stack (top resolves first)'));
        [...state.stack].reverse().forEach(spell=>stack.append(node('div','','#'+spell.id+' · '+spell.name+' ('+(spell.side?'AI':'You')+')')));
        stage.append(stack);
      }
    }
    if(error)stage.append(node('div','error',error));
    stage.append(field(state.players[1],false,state.phase));
    stage.append(toolbar(state));
    stage.append(field(state.players[0],true,state.phase));
    stage.append(handView(state));
    const log=node('details','duel-log');log.open=true;
    log.append(node('summary','','Actions · most recent 35'));
    log.append(node('pre','',state.log.slice(-35).join('\n')));
    stage.append(log);
  }
  const start=(Ctor)=>safe(()=>{
    const mine=resolveDeck(mySelect.value),opponent=resolveDeck(opponentSelect.value);
    if(!mine||!opponent)throw new Error('Choose your deck and a saved opponent deck first.');
    duel=new Ctor(mine,opponent,{seed:Date.now()});
    duel.originalDecks=[mine,opponent];chosen=new Set();
    stage.scrollIntoView({behavior:'smooth',block:'start'});
  });
  launch.addEventListener('click',start(LiveDuel));
  if(launchRules)launchRules.addEventListener('click',start(RulesDuel));
  render();
}
