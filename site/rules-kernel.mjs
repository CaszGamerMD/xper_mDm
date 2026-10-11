/** Explicitly implemented card subset for Rules Lab.
 * Reject unhandled Oracle text: unknown mechanics must not be fabricated.
 */
const lower=s=>String(s||'').toLowerCase();
const primary=card=>String(card.type||card.type_line||'').split(' // ')[0].split(' — ')[0];
const simple=/^(?:(?:flying|first strike|double strike|deathtouch|defender|haste|hexproof|indestructible|lifelink|reach|trample|vigilance)(?:,\s*|\s*\n\s*))*?(?:flying|first strike|double strike|deathtouch|defender|haste|hexproof|indestructible|lifelink|reach|trample|vigilance)?\.?$/i;
const positive=/^(\d+|one|two|three|four)$/;
const asInt=v=>({'one':1,'two':2,'three':3,'four':4}[v]||Number(v));
export function isInstant(card){return /\bInstant\b/.test(primary(card));}
export function isLand(card){return /\bLand\b/.test(primary(card));}
export function isCreature(card){return /\bCreature\b/.test(primary(card));}
export function isPermanent(card){return /\b(Creature|Artifact|Enchantment|Planeswalker|Battle)\b/.test(primary(card));}
export function hasAbility(card,keyword){
  const text=lower(card.oracle_text),key=lower(keyword);
  return (card.keywords||[]).some(k=>lower(k)===key)||new RegExp('(^|[\\n, ])'+key+'(?=$|[,\\n.])','i').test(text);
}
export function supportInfo(card){
  const text=lower(card.oracle_text).replace(/\r/g,'').trim().replace(/\.+$/,'');
  if(isLand(card)) {
    const basic=/\bBasic\b/.test(String(card.type||card.type_line));
    const landSource = /^\{t\}: add \{[wubrgc]\}(?:\{[wubrgc]\})?$/i.test(text);
    return {supported:basic||landSource,kind:'land',reason:basic||landSource?'':'Complex land ability not yet implemented'};
  }
  // Basic vanilla creatures and creatures consisting solely of evergreen keywords.
  if(isCreature(card) && (!text||simple.test(text)))
    return {supported:true,kind:'creature'};
  if(!isInstant(card) && !/\bSorcery\b/.test(primary(card)))
    return {supported:false,kind:'unsupported',reason:'Permanent activated, triggered, and continuous effects are not yet supported'};
  let m;
  if((m=/^draw (a|one|two|three|four|[1-4]) cards?$/i.exec(text)))
    return {supported:true,kind:'draw',amount:asInt(m[1]==='a'?'one':m[1])};
  if((m=/^(destroy|exile) target creature$/i.exec(text)))
    return {supported:true,kind:m[1],target:'creature'};
  if(/^counter target spell$/i.test(text))
    return {supported:true,kind:'counter',target:'spell'};
  if(/^return target creature to its owner's hand$/i.test(text))
    return {supported:true,kind:'bounce',target:'creature'};
  if((m=/^(?:(?:[\w ,'-]+)|this spell) deals? ([1-9]|10) damage to (any target|target creature|target player)$/i.exec(text)))
    return {supported:true,kind:'damage',target:m[2]==='target creature'?'creature':m[2]==='target player'?'player':'any',amount:Number(m[1])};
  if((m=/^(?:you )?gain ([1-9]|10) life$/i.exec(text)))
    return {supported:true,kind:'gain',amount:Number(m[1])};
  return {supported:false,kind:'unsupported',reason:'This Oracle text needs a dedicated rules implementation'};
}
export function supportedShare(deck){
  const list=(deck.groups||[]).flatMap(g=>g.cards||[]);
  const seen=list.reduce((state,card)=>{
    const info=supportInfo(card);
    if(info.supported)state.supported+=Number(card.quantity||1);
    else state.unsupported.push({name:card.name,quantity:card.quantity||1,reason:info.reason});
    state.total+=Number(card.quantity||1);
    return state;
  },{total:0,supported:0,unsupported:[]});
  const commander=supportInfo(deck.commander);
  return {...seen,commanderSupported:commander.supported,commanderReason:commander.reason||'',
    percentage:seen.total?Math.round(100*seen.supported/seen.total):0};
}
