import { generateDecks } from "./generator.mjs";
import { sortedCardGroups } from "./presentation.mjs";
import { interpretPrompt } from "./intent.mjs";
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
    ['Avg. mana value', Number(deck.average_cmc).toFixed(2), deck.target_cmc !== null && Math.abs(deck.average_cmc - deck.target_cmc) > .2]
  ]) {
    const m = elt('div', 'metric' + (flagged ? ' warning' : ''));
    m.append(elt('strong', '', value), elt('span', '', label)); metrics.append(m);
  }
  meta.append(metrics);
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
  }, true));
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
  output.append(elt('p', 'attribution', 'Every card was checked for paper Commander legality and color identity when generated. This score is a heuristic for construction quality—not a guaranteed power level, metagame ranking, or playtest result.'));
}
