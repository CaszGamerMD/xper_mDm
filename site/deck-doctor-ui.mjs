/** In-browser upload + before/after ratings. User uploads stay in this browser. */
import {DeckDoctor} from './deck-doctor.mjs';
const elem=(tag,cls='',value)=>{
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(value!==undefined)e.textContent=String(value);
  return e;
};
const button=(label,callback,secondary=false)=>{
  const b=elem('button','action'+(secondary?' secondary':''),label);
  b.type='button';b.addEventListener('click',callback);return b;
};
const field=(id,label,control,small)=>{
  const box=elem('div','fieldgroup');
  const title=elem('label','',label);
  title.htmlFor=id;
  if(small)title.append(elem('small','',small));
  box.append(title,control);return box;
};
function metric(label,value){
  const m=elem('div','metric');
  m.append(elem('strong','',value),elem('span','',label));
  return m;
}
const fmt=v=>Number(v).toFixed(1);
export function mountDeckDoctor({saveDeck,openDeck}){
  const stage=document.getElementById('deck-doctor');
  const heading=elem('div','panelheading');
  heading.append(elem('span','','03'),elem('h2','','Deck Doctor · Rate & improve your deck'));
  stage.append(heading,elem('p','play-explain',
    'Upload or paste an existing Commander decklist. See its estimated deck-construction score, then find small legal upgrades. The commander stays unless an alternate scores at least 15 points higher against your original, unchanged 99 cards. All swaps are shown before you save.'));
  const form=elem('form','doctor-form');form.id='doctor-form';
  const inputs=elem('div','doctor-inputs');
  const file=elem('input');file.type='file';file.id='doctor-file';
  file.accept='.txt,.dek,.dec,text/plain';
  inputs.append(field('doctor-file','Upload decklist',file,'Optional · plain-text file'));
  const commander=elem('input');commander.id='doctor-commander';commander.type='text';
  commander.maxLength=150;commander.placeholder='Commander name, or include a Commander section';
  inputs.append(field('doctor-commander','Commander name',commander,'Optional with Commander header'));
  const max=elem('select');max.id='doctor-max';
  for(const [num,label] of [[4,'4 swaps · conservative'],[8,'8 swaps · modest tune-up'],
    [12,'12 swaps · deeper tuning'],[20,'20 swaps · extensive tuning'],[0,'0 swaps · rate only']]){
    const option=elem('option','',label);option.value=String(num);max.append(option);
  }
  max.value='8';inputs.append(field('doctor-max','Maximum card swaps',max));
  const allowLabel=elem('label','doctor-switch');
  const allow=elem('input');allow.type='checkbox';allow.checked=true;
  allowLabel.append(allow,document.createTextNode(' Suggest commander replacement only for a major (+15 point) score gain with no other changes'));
  inputs.append(allowLabel);
  form.append(inputs);
  const list=elem('textarea');list.id='doctor-list';list.rows=12;list.maxLength=32000;
  list.placeholder='// Commander\n1 Muldrotha, the Gravetide\n\n// Deck\n1 Sol Ring\n1 Arcane Signet\n...';
  form.append(field('doctor-list','Paste decklist',list,'99 main-deck cards + single commander · 1 Sol Ring or 1x Sol Ring'));
  const run=elem('button','generate','✦ Rate & optimize deck');run.type='submit';
  form.append(run,elem('p','hint',
    'Uses live Scryfall Commander data and the same transparent role, curve and cohesion heuristics. This is not a real win-rate prediction and cannot prove a combo works. The submitted list stays in your browser.'));
  const progress=elem('p','hint');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
  const results=elem('div','doctor-output');results.setAttribute('aria-live','polite');
  stage.append(form,progress,results);
  const doctor=new DeckDoctor();
  let currentRun=0;
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(!selected)return;
    if(selected.size>160000){progress.textContent='This file is too large. Please select a plain-text decklist under 160 KB.';return;}
    try{list.value=await selected.text();progress.textContent='Loaded '+selected.name+' in your browser. Ready to rate.';}
    catch{progress.textContent='Could not read that file. Use a plain-text decklist.';}
  });
  function explainScore(metrics,kind){
    const section=elem('div','doctor-score-card');
    section.append(elem('h3','',kind));
    const row=elem('div','metrics');
    for(const [name,num] of [['Estimated / 100',fmt(metrics.score)],['Lands',metrics.lands+' / '+(metrics.land_target||37)],
      ['Avg nonland MV',fmt(metrics.average_cmc)],['Connected cards',metrics.connected],
      ['Commander fit',metrics.commander_fit+'/20']])
      row.append(metric(name,num));
    section.append(row);
    const chart=elem('div','doctor-breakdown');
    for(const [key,name] of [['roles','Roles'],['engine','Engine cohesion'],['mana_base','Mana base'],
      ['land_penalty','Short-land penalty'],['mana_curve','Mana curve'],['commander','Commander fit']]){
      chart.append(elem('span','',name),elem('strong','',fmt(metrics.breakdown[key])));
    }
    section.append(chart);
    const roles=elem('p','doctor-role-counts',
      'Ramp '+metrics.roles.ramp+' · Draw '+metrics.roles.draw+
      ' · Interaction '+metrics.roles.removal+' · Protection '+metrics.roles.protection+
      ' · Wipes '+metrics.roles.wipe+' · Finishers '+metrics.roles.finisher);
    section.append(roles);
    if(metrics.mana_balance){
      const mana=metrics.mana_balance;
      const line=elem('p','doctor-mana-sources','Colored mana access: '+
        mana.colors.map(c=>c+' '+mana.sources[c]+'/'+Math.ceil(mana.targets[c])+' estimated sources').join(' · '));
      section.append(line);
    }
    if(metrics.warnings?.length) {
      const notes=elem('div','doctor-notes');
      metrics.warnings.slice(0,5).forEach(w=>notes.append(elem('p','',w)));
      section.append(notes);
    }
    return section;
  }
  function actions(deck,caption){
    const row=elem('div','doctor-result-actions');
    row.append(button('Copy this decklist',async()=>{
      try{await navigator.clipboard.writeText(deck.export);progress.textContent='Decklist copied.';}
      catch{progress.textContent='Clipboard permission blocked. Select and copy the decklist shown below.';}
    },true));
    row.append(button('Save '+caption+' locally',()=>{
      try{saveDeck(deck);progress.textContent='Saved '+caption+' in this browser’s deck vault.';}
      catch(e){progress.textContent='Could not save: '+e.message;}
    }));
    row.append(button('Use '+caption+' as my deck',()=>{
      openDeck(deck);progress.textContent='Opened '+caption+' as your deck.';
    },true));
    const expand=elem('details','doctor-text');
    expand.append(elem('summary','','Show copyable decklist'));
    const text=elem('textarea');text.readOnly=true;text.rows=9;text.value=deck.export;
    expand.append(text);row.append(expand);
    return row;
  }
  function render(result){
    results.replaceChildren();
    const top=elem('div','doctor-score-grid');
    top.append(explainScore(result.original,'Original deck'),explainScore(result.upgraded,'Optimized deck'));
    results.append(top);
    const gained=Number((result.upgraded.score-result.original.score).toFixed(2));
    results.append(elem('p','doctor-highlight',
      result.swaps.length+' evidence-gated suggestion(s), '+result.keptCount+' of 99 original cards retained. '+
      'Score '+fmt(result.original.score)+' → '+fmt(result.upgraded.score)+
      ' ('+(gained>=0?'+':'')+fmt(gained)+'). Commander preserved: '+result.originalCommander+'.'));
    const info=elem('p','hint','Detected core: '+(result.context.plan||'General value')+
      (result.context.tribes.length?' · '+result.context.tribes.join('/')+' tribal':'')+
      '. The optimization keeps this strategy fixed so an apparent score gain cannot come from changing the evaluation criteria.');
    results.append(info);
    if(result.upgraded.lands<result.upgraded.land_target){
      results.append(elem('p','doctor-land-remaining',
        'Still under the estimated land target: '+result.upgraded.lands+' / '+result.upgraded.land_target+
        '. The optimizer did not find another legal, low-disruption land swap that improved its structural rating. '+
        'This does NOT mean the current mana base is optimal. Manually review the remaining land shortfall.'));
    }
    results.append(elem('p','doctor-confidence-note',
      'Recommendations are hypotheses about structural improvements, NOT verified upgrades or demonstrated win-rate gains. '+
      'Existing recognized engine enablers and payoffs are protected from unrelated substitutions. '+
      'Land-count repairs are prioritized. Maximum changes is a ceiling, not a swap quota. '+
      'Inspect the exact before/after evidence for each proposed change before saving.'));
    const table=elem('table','doctor-swap-table');
    const head=elem('thead');const header=elem('tr');
    for(const title of ['Remove','Add','Reason','Estimated gain'])header.append(elem('th','',title));
    head.append(header);table.append(head);
    const body=elem('tbody');
    if(result.swaps.length===0){
      const row=elem('tr'),cell=elem('td','','No supported change passed the conservative score-and-evidence checks. Your original deck is preserved.');
      cell.colSpan=4;row.append(cell);body.append(row);
    }else for(const swap of result.swaps){
      const row=elem('tr');
      for(const card of [swap.outCard||{name:swap.out},swap.inCard||{name:swap.in}]){
        const td=elem('td','doctor-card-cell');
        const tile=elem('div','doctor-card-link');
        if(card.image){
          const img=elem('img','doctor-swap-art');img.src=card.image;img.alt=card.name;img.loading='lazy';
          tile.append(img);
        }
        const link=elem('a','',card.name);
        if(card.url){link.href=card.url;link.target='_blank';link.rel='noopener noreferrer';}
        tile.append(link);td.append(tile);row.append(td);
      }
      const reason=elem('td','doctor-why');
      reason.append(elem('strong','',swap.reason));
      reason.append(elem('small','',swap.evidence||'No additional role evidence available'));
      row.append(reason,elem('td','','+'+fmt(swap.gain)));
      body.append(row);
    }
    table.append(body);results.append(elem('h3','','Proposed card-for-card swaps'),table);
    results.append(actions(result.upgradedDeck,'optimized deck'));
    if(result.commanderSuggestion){
      const candidate=result.commanderSuggestion;
      const suggestion=elem('div','doctor-commander');
      suggestion.append(elem('h3','','Major commander-only improvement found'),
        elem('p','',
          result.originalCommander+' → '+candidate.commander.name+
          '. The exact same original 99 cards rate '+fmt(candidate.score.score)+
          ' instead of '+fmt(result.original.score)+' (+'+fmt(candidate.gain)+').'));
      suggestion.append(elem('p','hint','This is an optional alternative; it does not quietly change the primary tuned result.'));
      suggestion.append(actions(result.commanderOnlyDeck,'commander-only alternative'));
      results.append(suggestion);
    }else {
      results.append(elem('p','hint',
        'Commander retained. No alternative cleared the +15-point threshold on the unchanged original 99 cards (or commander search was disabled).'));
    }
    results.append(elem('p','hint','Scores assess deck construction, role density, curve and recognizable synergy. They are heuristic, not experimentally established power levels. Upgrades also depend on the cards returned by Scryfall; this is not an exhaustive search of every printed Magic card.'));
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const serial=++currentRun;
    run.disabled=true;run.textContent='Analyzing deck…';
    progress.textContent='Checking decklist…';results.replaceChildren();
    try{
      const analyzed=await doctor.diagnose(list.value,
        {commander:commander.value.trim(),maxSwaps:Number(max.value),considerCommander:allow.checked},
        text=>{if(serial===currentRun)progress.textContent=text;});
      if(serial!==currentRun)return;
      render(analyzed);
      progress.textContent='Analysis complete. Review the swaps and save only what you want.';
    }catch(error){
      if(serial===currentRun)progress.textContent='⚠ '+(error.message||'Could not analyze the decklist.');
    }finally{
      if(serial===currentRun){run.disabled=false;run.textContent='✦ Rate & optimize deck';}
    }
  });
}
