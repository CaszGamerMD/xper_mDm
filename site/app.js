import { generateDecks } from "./generator.mjs";
import { sortedCardGroups } from "./presentation.mjs";
import { interpretPrompt } from "./intent.mjs";
import {DeckLibrary, importDecklist, simulateSeries} from "./playtest.mjs";
const form = document.getElementById('builder');
const output = document.getElementById('output');
const submit = document.getElementById('submit');
const submitText = document.getElementById('submit-text');
const colors = new Set();
let decks = [];
let chosen = 0;
let cardDisplay = 'list';
let cardSort = 'type-cmc';

function elt(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function commaList(id, limit) {
  return document.getElementById(id).value.split(',').map(s => s.trim()).filter(Boolean).slice(0, limit);
}
const curveToggle=document.getElementById('use-curve');
const curveSlider=document.getElementById('target-cmc');
const curveValue=document.getElementById('curve-value');
curveToggle.addEventListener('change',()=>{curveSlider.disabled=!curveToggle.checked;});
curveSlider.addEventListener('input',()=>{curveValue.textContent=Number(curveSlider.value).toFixed(1);});
const promptInput=document.getElementById('deck-prompt');
promptInput.addEventListener('input',()=>{
  const parsed=interpretPrompt(promptInput.value);
  const matches=[...parsed.creature_types,...parsed.keywords];
  document.getElementById('prompt-preview').textContent = matches.length
    ? 'Recognized: '+matches.join(' · ')
    : (promptInput.value.trim() ? 'No recognizable themes yet. Try a mechanic such as blink, tokens or landfall.' : '');
});
for (const chip of document.querySelectorAll('[data-color]')) {
  chip.addEventListener('click', () => {
    const color = chip.dataset.color;
    if (colors.has(color)) colors.delete(color); else colors.add(color);
    chip.setAttribute('aria-pressed', String(colors.has(color)));
  });
}
function button(text, callback, secondary = false) {
  const b = elt('button', 'action' + (secondary ? ' secondary' : ''), text);
  b.type = 'button'; b.addEventListener('click', callback); return b;
}
function showLoading() {
  output.className = 'loading'; output.replaceChildren();
  output.append(elt('div', 'spinner'), elt('h3', '', 'Finding legal cards and crafting a mana base…'),
    elt('p', '', 'The forge is checking Commander legality, card roles, and theme support against Scryfall.'));
}
function showError(message) {
  output.className = '';
  output.replaceChildren(elt('div', 'error', message));
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const favorites = document.getElementById('favorites').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (favorites.length > 5) { showError('Please enter no more than five must-have cards.'); return; }
  const payload = {
    colors: [...colors], creature_types: commaList('tribes', 3),
    keywords: commaList('mechanics', 5),
    commander: document.getElementById('commander').value.trim(),
    favorites, prompt:promptInput.value.trim(),
    target_cmc:curveToggle.checked ? Number(curveSlider.value) : null,
    options: Number(document.getElementById('options').value)
  };
  submit.disabled = true; submitText.textContent = 'Forging…'; showLoading();
  try {
    decks = await generateDecks(payload, message => {
      const label = output.querySelector('p');
      if (label) label.textContent = message;
    });
    chosen = 0;
    if (!decks.length) throw new Error('No legal deck options found for these inputs.');
    render();
  } catch (error) {
    showError(error.message || 'Deck generation failed. Please try again.');
  } finally { submit.disabled = false; submitText.textContent = 'Forge decks'; }
});

function render() {
  output.className = ''; output.replaceChildren();
  const tabs = elt('div', 'tabs');
  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i];
    const tab = elt('button', 'tab' + (chosen === i ? ' active' : ''));
    tab.type = 'button';
    tab.append(elt('strong', '', `0${i + 1}  ${deck.name.split(' — ').slice(-1)[0]}`),
      elt('small', '', deck.confidence + ' confidence'));
    tab.addEventListener('click', () => { chosen = i; render(); });
    tabs.append(tab);
  }
  output.append(tabs);
  const deck = decks[chosen];
  const hero = elt('div', 'deck-hero');
  if (deck.commander.image) {
    const art = elt('img', 'art'); art.src = deck.commander.image;
    art.alt = `Card art for ${deck.commander.name}`; art.loading = 'lazy'; hero.append(art);
  }
  const meta = elt('div', 'deck-meta');
  meta.append(elt('h3', '', deck.name), elt('div', 'identity', `COLOR IDENTITY  ${deck.commander.color_identity.join(' · ') || 'COLORLESS'}`),
    elt('p', '', deck.description));
  const metrics = elt('div', 'metrics');
  for (const [label, value, flagged] of [
    ['Total cards', deck.total_cards, deck.total_cards !== 100],
    ['Confidence', deck.confidence, deck.confidence === 'Low'],
    ['Structure score', `${deck.quality_score}/100`, deck.quality_score < 61],
    ['Theme cards', deck.theme_cards, false],
    ['Engine cohesion', deck.cohesion ? `${deck.cohesion.score}/100` : '—', deck.cohesion && deck.cohesion.score < 50],
    ['Avg. mana value', Number(deck.average_cmc).toFixed(2), deck.target_cmc !== null && Math.abs(deck.average_cmc - deck.target_cmc) > .2]
  ]) {
    const m = elt('div', 'metric' + (flagged ? ' warning' : ''));
    m.append(elt('strong', '', value), elt('span', '', label)); metrics.append(m);
  }
  meta.append(metrics);
  if (deck.cohesion) meta.append(elt('p','curve-outcome', `Core strategy: ${deck.cohesion.plan} · ${deck.cohesion.enablers} enablers · ${deck.cohesion.payoffs} payoffs · ${deck.cohesion.connected} connected spells.`));
  if (deck.target_cmc !== null) meta.append(elt('p','curve-outcome', `Target average: ${deck.target_cmc.toFixed(1)} · Actual: ${deck.average_cmc.toFixed(2)} (excludes commander and lands)`));
  const actions = elt('div', 'deck-actions');
  actions.append(button('↓ Download .txt', () => {
    const blob = new Blob([deck.export], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = deck.commander.name.replace(/[^a-z0-9-]/gi, '_') + '_' + (chosen + 1) + '.txt';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }), button('⧉ Copy decklist', async () => {
    try { await navigator.clipboard.writeText(deck.export); }
    catch { const editor = elt('textarea'); editor.value = deck.export; document.body.append(editor); editor.select(); document.execCommand('copy'); editor.remove(); }
  }, true), button('♡ Save to this browser', () => {
    try{vault.save(deck);refreshVault();showVaultStatus('Saved '+deck.name+' locally.');}
    catch(error){showVaultStatus(error.message);}
  },true));
  meta.append(actions); hero.append(meta); output.append(hero);
  if (deck.warnings.length) {
    const warnings = elt('div', 'warningbox');
    for (const message of deck.warnings) warnings.append(elt('div', '', '⚠ ' + message));
    output.append(warnings);
  }
  const browse = elt('section','deck-browser');
  const browseHead = elt('div','browser-head');
  browseHead.append(elt('h4','','99-card main deck · sorted by card type and mana value'));
  const controls=elt('div','browser-controls');
  const displaySwitch=elt('div','display-switch');
  for(const [kind,label] of [['list','☷ List'],['gallery','▦ Card previews']]) {
    const tab=button(label,()=>{cardDisplay=kind;render();});
    tab.setAttribute('aria-pressed',String(cardDisplay===kind));
    displaySwitch.append(tab);
  }
  const sortLabel=elt('label','sort-label','Sort');
  const sortSelect=elt('select','sort-select');
  for(const [value,label] of [['type-cmc','Card type → mana value'],['cmc-type','Mana value → card type']]) {
    const option=elt('option','',label); option.value=value;sortSelect.append(option);
  }
  sortSelect.value=cardSort;
  sortSelect.addEventListener('change',()=>{cardSort=sortSelect.value;render();});
  sortLabel.append(sortSelect);
  controls.append(displaySwitch,sortLabel);
  browseHead.append(controls);
  browse.append(browseHead);
  for(const group of sortedCardGroups(deck,cardSort)) {
    const details=elt('details','cardgroup');
    details.open = cardDisplay==='gallery' || ['Creature','Land'].includes(group.name) || cardSort==='cmc-type';
    const total=group.cards.reduce((sum,c)=>sum+c.quantity,0);
    details.append(elt('summary','',`${group.name}  ·  ${total} cards`));
    if(cardDisplay==='gallery') {
      const gallery=elt('div','card-grid');
      for(const card of group.cards) {
        const link=elt('a','card-tile');
        link.href=card.url || '#';link.target='_blank';link.rel='noopener noreferrer';
        if(card.image) {
          const image=elt('img','card-preview');image.src=card.image;image.alt=card.name;
          image.loading='lazy';image.decoding='async';link.append(image);
        } else link.append(elt('div','preview-fallback',card.name));
        const caption=elt('div','preview-caption');
        caption.append(elt('strong','',`${card.quantity}× ${card.name}`),elt('small','',`Mana value ${card.cmc} · ${card.type}`));
        link.append(caption);gallery.append(link);
      }
      details.append(gallery);
    } else {
      const table=elt('table','sorted-list');
      for(const card of group.cards) {
        const row=elt('tr');
        const name=elt('td');
        const link=elt('a','',card.name);
        link.href=card.url || '#';link.target='_blank';link.rel='noopener noreferrer';
        name.append(link);
        row.append(elt('td','',`${card.quantity}×`),name,elt('td','type-cell',card.type),elt('td','mana-cell',`MV ${card.cmc}`));
        table.append(row);
      }
      details.append(table);
    }
    browse.append(details);
  }
  output.append(browse);
  output.append(elt('p', 'attribution', 'Every card was checked for paper Commander legality and color identity when generated. Synergy and playtest ratings are heuristic estimates, not true game outcomes.'));
  refreshVault();
}


// Browser-only personal deck library: localStorage is preferable to cookies for 100-card lists.
let vault;
try { vault=new DeckLibrary(window.localStorage); }
catch {vault=new DeckLibrary({getItem:()=>null,setItem:()=>{throw new Error('Local storage is disabled.');}});}
const mySelect=document.getElementById('play-your-deck');
const opponentSelect=document.getElementById('play-opponent-deck');
function showVaultStatus(message){document.getElementById('vault-status').textContent=message;}
function refillSelect(select,records,placeholder) {
  const previous=select.value;
  select.replaceChildren();
  const empty=elt('option','',placeholder);empty.value='';select.append(empty);
  for(const item of records){
    const option=elt('option','',item.name);
    option.value=item.id;select.append(option);
  }
  if(records.some(item=>item.id===previous))select.value=previous;
}
function refreshVault() {
  const generated=decks.map((deck,index)=>({id:'generated:'+index,name:'New: '+deck.name}));
  const saved=vault.list().map(item=>({id:'saved:'+item.id,name:'Saved: '+item.name}));
  refillSelect(mySelect,[...generated,...saved],'Choose your deck');
  refillSelect(opponentSelect,saved,'Choose a saved opponent');
  if(!mySelect.value && generated.length)mySelect.value=generated[chosen].id;
}
function resolveDeck(value) {
  if(value.startsWith('generated:'))return decks[Number(value.split(':')[1])]||null;
  if(value.startsWith('saved:'))return vault.get(value.slice(6));
  return null;
}
refreshVault();
document.getElementById('import-deck-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=document.getElementById('import-submit');
  const status=document.getElementById('import-status');
  button.disabled=true;status.textContent='Looking up every card and checking Commander legality…';
  try{
    const deck=await importDecklist(
      document.getElementById('import-list').value,
      document.getElementById('import-commander').value.trim());
    const name=document.getElementById('import-title').value.trim()||deck.name;
    const id=vault.save(deck,name);
    refreshVault();opponentSelect.value='saved:'+id;
    status.textContent='Saved and ready as the opponent: '+name+'.';
    document.getElementById('import-list').value='';
  }catch(error){status.textContent='⚠ '+(error.message||'Could not import decklist.');}
  finally{button.disabled=false;}
});
document.getElementById('play-delete').addEventListener('click',()=>{
  if(!opponentSelect.value.startsWith('saved:'))return showVaultStatus('Select a saved opponent deck to delete.');
  vault.remove(opponentSelect.value.slice(6));refreshVault();showVaultStatus('Removed that deck from this browser.');
});
document.getElementById('play-match').addEventListener('click',()=>{
  const mine=resolveDeck(mySelect.value),theirs=resolveDeck(opponentSelect.value);
  const section=document.getElementById('play-results');
  section.replaceChildren();
  if(!mine||!theirs){
    section.append(elt('p','error','Choose your generated or saved deck, then import/select a saved opponent deck.'));
    return;
  }
  try {
    const series=simulateSeries(mine,theirs,20,41);
    const heading=elt('h3','','20 simulated games · '+mine.commander.name+' vs '+theirs.commander.name);
    const metrics=elt('div','metrics');
    for(const [title,value] of [
      ['Your modeled wins',series.wins],['Opponent modeled wins',series.losses],
      ['Draws',series.draws],['Projected endings',series.projected]
    ]) {
      const m=elt('div','metric');m.append(elt('strong','',value),elt('span','',title));metrics.append(m);
    }
    section.append(heading,metrics,elt('p','hint',
      'These counts are NOT competitive win-rate predictions: the AI uses approximate mana, combat, spell effects and threat evaluation. Inspect the sample game to spot curve and interaction problems.'));
    const details=elt('details','play-log');
    details.open=true;
    details.append(elt('summary','','Sample game · '+series.example.turn+' turns · result: '+series.example.winner+
      (series.example.projected?' (projected)':'')));
    const pre=elt('pre','',series.example.log.join('\n'));
    details.append(pre);section.append(details);
  }catch(error){section.append(elt('p','error',error.message||'Simulation could not run.'));}
});
