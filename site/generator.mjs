/** In-browser Commander generator. No private keys, backend, or build step required.
 * All card identities, bans, and format legalities originate from live Scryfall cards.
 * Heuristic construction is deliberately distinct from rules validation.
 */
import { BASICS, ROLE_SEEDS, ROLE_QUERIES, THEMES } from './seeds.mjs';
import { interpretPrompt } from './intent.mjs';
import {lookupNamedCard} from './card-lookup.mjs';
import { averageSpellManaValue } from './presentation.mjs';
import { deckPlan, synergyFeatures, cohesionReport, THEME_SEARCHES } from './synergy.mjs';

export const COLORS = 'WUBRG';
export const ROLE_ORDER = ['ramp', 'draw', 'removal', 'protection', 'wipe', 'finisher', 'synergy'];
const ROLE_LABELS = {
  ramp: 'Ramp', draw: 'Card advantage', removal: 'Interaction', protection: 'Protection',
  wipe: 'Board wipes', finisher: 'Finishers', synergy: 'Theme & creatures', land: 'Lands'
};
const PROFILES = [
  ['Theme First', 'Maximizes tribal and mechanical synergy.', {ramp:9,draw:9,removal:8,protection:3,wipe:3,finisher:3,synergy:27}],
  ['Balanced', 'A balanced mix of threats, mana, cards and answers.', {ramp:10,draw:10,removal:9,protection:4,wipe:3,finisher:4,synergy:22}],
  ['Resilient', 'Adds answers and protection for longer games.', {ramp:10,draw:11,removal:11,protection:5,wipe:4,finisher:3,synergy:18}],
  ['Fast Engine', 'Leans into early mana and payoff density.', {ramp:12,draw:9,removal:7,protection:3,wipe:2,finisher:4,synergy:25}]
];
const SEED_SET = Object.fromEntries(Object.entries(ROLE_SEEDS).map(([role,names]) => [role,new Set(names.map(name=>name.toLowerCase()))]));

export class DeckInputError extends Error {}
export class CardDataError extends Error {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const lower = value => String(value || '').toLocaleLowerCase();
const normalized = card => lower(card.name);
const uniqueBy = (items, keyFn) => [...new Map(items.map(item => [keyFn(item), item])).values()];
const identity = colors => COLORS.split('').filter(color => colors.includes(color)).join('') || 'C';
// Commander rule 903.5d: a land with a basic land type requires that color
// in the commander identity even if the land's printed color identity is empty.
export function withinIdentity(card, commander) {
  if (!card.color_identity.every(color => commander.color_identity.includes(color))) return false;
  const types = {Plains:'W', Island:'U', Swamp:'B', Mountain:'R', Forest:'G'};
  const faces = card.type_line.split(' // ');
  for (const face of faces) {
    const match = face.match(/\bLand\b[^—]*—\s*(.*)$/);
    if (!match) continue;
    for (const [type, color] of Object.entries(types)) {
      if (new RegExp('\\b' + type + '\\b').test(match[1]) && !commander.color_identity.includes(color)) return false;
    }
  }
  return true;
}
const cleanTerm = term => String(term).replace(/[^\p{L}\p{N}\s+/-]/gu, '').trim().slice(0,48);
const safeQuote = term => '"' + cleanTerm(term).replace(/"/g, '') + '"';

export function cardFromScryfall(raw) {
  const faces = raw.card_faces || [];
  const faceImage = faces.find(face => face.image_uris)?.image_uris || {};
  const type = raw.type_line || '';
  const text = raw.oracle_text || faces.map(face => face.oracle_text || '').join('\n');
  const land = type.split(' // ')[0].split(' — ')[0].split(' ').includes('Land');
  return {
    name: raw.name,
    oracle_id: raw.oracle_id || raw.id,
    type_line: type,
    oracle_text: text,
    mana_cost: raw.mana_cost || faces.map(face => face.mana_cost || '').join(' // '),
    cmc: Number(raw.cmc || 0),
    color_identity: raw.color_identity || [],
    legal: raw.legalities?.commander === 'legal',
    paper: (raw.games || []).includes('paper'),
    keywords: raw.keywords || [],
    edhrec_rank: raw.edhrec_rank || 999999,
    produced_mana: raw.produced_mana || [],
    image: (raw.image_uris || faceImage).normal || (raw.image_uris || faceImage).small || '',
    url: raw.scryfall_uri || '',
    land,
    basic: land && type.split(' // ')[0].split(' ').includes('Basic'),
    creature: type.includes('Creature'),
    power: raw.power || faces[0]?.power || '', toughness: raw.toughness || faces[0]?.toughness || '',
    commander: (type.includes('Legendary') && type.includes('Creature')) || lower(text).includes('can be your commander'),
    eligible: raw.legalities?.commander === 'legal' && (raw.games || []).includes('paper')
  };
}

export class ScryfallSource {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) {
    this.fetcher = fetcher;
    this.cache = new Map();
    this.nextRequestAt = 0;
    this.requestQueue = Promise.resolve();
  }
  async request(path, params = {}, method = 'GET', body = undefined, notFoundOK = false) {
    const url = new URL('https://api.scryfall.com' + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const cacheKey = method + url.href + (body ? JSON.stringify(body) : '');
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.date < 86400000) return cached.value;
    // Serialize API traffic (including requests originating from concurrently generated decks).
    let release;
    const mySlot = new Promise(resolve => { release = resolve; });
    const previous = this.requestQueue;
    this.requestQueue = mySlot;
    await previous;
    try {
      const wait = Math.max(0, this.nextRequestAt - Date.now());
      if (wait) await delay(wait);
      this.nextRequestAt = Date.now() + (method === 'POST' ? 550 : 135);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 23000);
      let response;
      try {
        response = await this.fetcher(url.href, {
          method, headers: {'Accept': 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
          ...(body ? {body:JSON.stringify(body)} : {}),
          credentials:'omit', signal:controller.signal
        });
      } catch (error) {
        throw new CardDataError('Could not reach Scryfall from this browser. Check your connection or browser privacy restrictions, then retry.');
      } finally { clearTimeout(timeout); }
      if (response.status === 404 && notFoundOK) return {};
      if (response.status === 429 || response.status === 503) throw new CardDataError('Scryfall is rate-limiting or unavailable. Please try again later.');
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).details || ''; } catch { /* ignore body */ }
        throw new CardDataError(`Scryfall request failed (${response.status})${detail ? ': '+detail : '.'}`);
      }
      const data = await response.json();
      this.cache.set(cacheKey, {date:Date.now(), value:data});
      return data;
    } finally { release(); }
  }
  async named(name) {
    const data = await this.request('/cards/named', {fuzzy:name}, 'GET', undefined, true);
    return data.object === 'card' ? cardFromScryfall(data) : null;
  }
  async collection(names) {
    const results = [];
    for (let index=0; index<names.length; index+=75) {
      const data = await this.request('/cards/collection', {}, 'POST',
        {identifiers:names.slice(index,index+75).map(name=>({name}))});
      results.push(...(data.data || []).map(cardFromScryfall));
    }
    return results;
  }
  async search(query, limit=150) {
    if (!query.trim()) return [];
    const found = new Map();
    for(let page=1; page<=2 && found.size<limit; page++) {
      const result = await this.request('/cards/search', {
        q:`legal:commander game:paper ${query}`, unique:'cards', order:'edhrec', page
      }, 'GET', undefined, true);
      for (const raw of result.data || []) {
        const card = cardFromScryfall(raw);
        if (card.eligible && !found.has(card.oracle_id)) found.set(card.oracle_id, card);
        if (found.size>=limit) break;
      }
      if (!result.has_more) break;
    }
    return [...found.values()];
  }
}

export function expandedTerms(keywords) {
  return [...new Set(keywords.flatMap(t => THEMES[lower(t).trim()] || [lower(t).trim()]).filter(Boolean))].slice(0,9);
}
export function themeScore(card, types, terms) {
  const oracle = lower(card.oracle_text);
  const typeline = lower(card.type_line);
  const keys = card.keywords.map(lower);
  let total=0;
  for(const kind of types) {
    const t=lower(kind);
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (card.creature && new RegExp('\\b'+escaped+'\\b').test(typeline)) total+=6;
    if (new RegExp('\\b'+escaped+'s?\\b').test(oracle)) total+=3.2;
  }
  for(const term of terms) {
    if (oracle.includes(term)) total+=2;
    if (keys.includes(term)) total+=2.8;
  }
  return Math.min(total,18);
}
export function roleMatch(card, role) {
  if (SEED_SET[role]?.has(normalized(card))) return true;
  const text=lower(card.oracle_text);
  const match = (...terms) => terms.some(term=>text.includes(term));
  switch(role) {
    case 'ramp': return match('add {','add one mana','search your library for a basic land','treasure token');
    case 'draw': return match('draw a card','draw two cards','draw three cards','draw x cards','draw cards');
    case 'removal': return match('destroy target','exile target','counter target spell','return target nonland');
    case 'protection': return match('hexproof','indestructible','phase out','protection from');
    case 'wipe': return match('destroy all creatures','exile all creatures','each creature gets -','13 damage to each creature');
    case 'finisher': return match('each opponent loses','win the game','creatures you control get +','deals damage to each opponent');
    default: return true;
  }
}
function noise(card, variant) {
  // Stable lightweight FNV-1a hash: makes profiles distinct across reloads.
  let hash=2166136261;
  for (const char of card.oracle_id + ':' + variant) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0)/2**32;
}
function cardScore(card,role,theme,variant,structural=0,hasPlan=false) {
  const popular=Math.max(0,5.6-Math.log10(Math.max(card.edhrec_rank,1))*.92);
  let curve=card.cmc>=1&&card.cmc<=4?1.1:card.cmc>=8?-1:0;
  if (role==='finisher') curve=card.cmc>=4&&card.cmc<=8?1.2:0;
  if (role==='ramp' && card.cmc>3) curve-= (card.cmc-3)*.55;
  const planBonus=hasPlan ? structural*(role==='synergy'?1.45:.75) - (role==='synergy' && !structural?8:0) : 0;
  return popular+theme*(role==='synergy'?1.0:.3)+planBonus+curve+[.35,.65,.45,1.35][variant]*noise(card,variant)*1.4;
}

export function validateDeck(deck) {
  const commander=deck.commander;
  if (!commander.eligible || !commander.commander) throw new DeckInputError('The selected commander is not a legal single-card Commander commander.');
  if (deck.main.length + deck.basics.reduce((n,[,qty])=>n+qty,0) !== 99) throw new DeckInputError('Could not produce a complete 99-card main deck.');
  const seen=new Set([normalized(commander)]);
  for (const [card] of deck.main) {
    if (!card.eligible || !withinIdentity(card,commander)) throw new DeckInputError(`Illegal card for this commander: ${card.name}.`);
    if (seen.has(normalized(card))) throw new DeckInputError(`Duplicate card: ${card.name}.`);
    seen.add(normalized(card));
  }
  for (const [basic,qty] of deck.basics) {
    if (!basic.basic || !basic.eligible || !withinIdentity(basic,commander) || !Number.isInteger(qty) || qty<1)
      throw new DeckInputError(`Invalid basic land: ${basic.name}.`);
    // Basic lands may be repeated, even if one copy was explicitly pinned.
  }
  return true;
}

export class BrowserGenerator {
  constructor(source = new ScryfallSource()) {
    this.source=source;
    this.seeds=null;
    this.basics=null;
  }
  async getSeeds() {
    if (!this.seeds) this.seeds=await this.source.collection(uniqueBy(Object.values(ROLE_SEEDS).flat(), name=>lower(name)));
    return this.seeds;
  }
  async getBasics() {
    if (!this.basics) {
      const list = await this.source.collection(Object.values(BASICS));
      this.basics = Object.fromEntries(Object.entries(BASICS).map(([color,name])=>[color,list.find(card=>card.name===name)]));
      const missing=Object.entries(this.basics).filter(([,c])=>!c).map(([color])=>BASICS[color]);
      if (missing.length) throw new CardDataError('Could not load basic land data: '+missing.join(', '));
    }
    return this.basics;
  }
  async getFavorites(req) {
    const found=[];
    for (const name of req.favorites) {
      const card=await lookupNamedCard(name,this.source);
      if(!card) throw new DeckInputError('Could not find favorite card: '+name+'.');
      if(!card.eligible) throw new DeckInputError(card.name+' is not legal in paper Commander.');
      if(!found.some(c=>normalized(c)===normalized(card))) found.push(card);
    }
    return found;
  }
  async commanders(req,favorites) {
    const needed = new Set(favorites.flatMap(card=>card.color_identity));
    if(req.commander) {
      const card=await lookupNamedCard(req.commander,this.source);
      if(!card) throw new DeckInputError('Could not find commander: '+req.commander+'.');
      if(!card.eligible || !card.commander) throw new DeckInputError(card.name+' is not a legal single-card Commander commander.');
      if(req.colors.length && identity(card.color_identity)!==identity(req.colors))
        throw new DeckInputError(`${card.name}'s color identity is ${identity(card.color_identity)}, not ${identity(req.colors)}.`);
      if(![...needed].every(color=>card.color_identity.includes(color)))
        throw new DeckInputError('One or more favorite cards are outside the selected commander’s color identity.');
      return [card];
    }
    const exact=req.colors.length?' id='+identity(req.colors):'';
    const pool = new Map();
    for(const kind of req.creature_types) {
      for(const c of await this.source.search(`is:commander${exact} o:${safeQuote(kind)}`,70)) pool.set(c.oracle_id,c);
    }
    for(const term of expandedTerms(req.keywords).slice(0,3)) {
      for(const c of await this.source.search(`is:commander${exact} o:${safeQuote(term)}`,70)) pool.set(c.oracle_id,c);
    }
    for(const c of await this.source.search(`is:commander${exact}`,175)) pool.set(c.oracle_id,c);
    const ranked=[...pool.values()].filter(c=> c.commander && c.eligible &&
      [...needed].every(color=>c.color_identity.includes(color)) &&
      (!req.colors.length || identity(c.color_identity)===identity(req.colors)));
    if(!ranked.length) throw new DeckInputError('No legal commander matches the chosen colors and favorite cards.');
    const terms=expandedTerms(req.keywords);
    ranked.sort((a,b)=>{
      const score=c=>themeScore(c,req.creature_types,terms)*2.2 + Math.max(0,7-Math.log10(Math.max(1,c.edhrec_rank))) + (c.creature?1.4:0);
      return score(b)-score(a);
    });
    return ranked.slice(0,req.options);
  }
  themes(req,commander) {
    const terms=expandedTerms(req.keywords);
    if(!terms.length) {
      const oracle=lower(commander.oracle_text);
      for(const [key,aliases] of Object.entries(THEMES)) if(oracle.includes(key)) terms.push(...aliases.slice(0,2));
      if(!terms.length) for(const word of ['token','graveyard','instant','sorcery','artifact','counter','land','draw']) if(oracle.includes(word)) terms.push(word);
    }
    return [...new Set(terms)].slice(0,9);
  }
  async pool(req,commander) {
    const filterId='id<='+identity(commander.color_identity);
    const terms=this.themes(req,commander);
    const plan=deckPlan(req.keywords,commander);
    const spells=new Map();
    const add=cards=>{for(const c of cards) if(c.eligible && withinIdentity(c,commander) && !c.land) spells.set(c.oracle_id,c);};
    add(await this.getSeeds());
    for(const kind of req.creature_types) {
      add(await this.source.search(`${filterId} t:${safeQuote(kind)} -t:land`,160));
      add(await this.source.search(`${filterId} o:${safeQuote(kind)} -t:land`,160));
    }
    for(const term of terms.slice(0,5)) add(await this.source.search(`${filterId} o:${safeQuote(term)} -t:land`,160));
    // Collect genuine enablers and payoffs for a chosen engine, not just coincidental text matches.
    for(const q of (THEME_SEARCHES[plan] || []).slice(0,2)) add(await this.source.search(`${filterId} ${q} -t:land`,140));
    for(const role of ['ramp','draw','removal'])
      for(const q of ROLE_QUERIES[role]) add(await this.source.search(`${filterId} ${q}`,100));
    add(await this.source.search(`${filterId} -t:land`,175));
    const lands=(await this.source.search(`${filterId} t:land -t:basic`,160)).filter(c=>c.land && c.eligible && withinIdentity(c,commander));
    return [[...spells.values()].filter(c=>normalized(c)!==normalized(commander)),lands,terms,plan];
  }
  pickNonbasics(lands,commander,variant,required,taken) {
    const colors=new Set(commander.color_identity);
    const counts=Object.fromEntries([...colors].map(color=>[color,0]));
    const pool=lands.filter(c=>!c.basic && !taken.has(normalized(c)));
    const selected=[];
    let utility=0;
    while(selected.length<required) {
      let best=null,score=-Infinity,bestProduced=[];
      for(const land of pool) {
        if(taken.has(normalized(land))) continue;
        let produced=land.produced_mana.filter(c=>colors.has(c));
        if(!produced.length && lower(land.oracle_text).includes('search your library for a basic land')) produced=[...colors];
        if(colors.size && !produced.length && utility>=5) continue;
        const prefer=produced.reduce((sum,c)=>sum+2.8/(1+(counts[c]||0)),0)+produced.length*1.1;
        const popular=Math.max(0,6-Math.log10(Math.max(land.edhrec_rank,1)));
        const value=prefer+popular+noise(land,variant)*1.2-(colors.size&&!produced.length?2:0);
        if(value>score){score=value;best=land;bestProduced=produced;}
      }
      if(!best) break;
      selected.push(best);taken.add(normalized(best));
      if(!bestProduced.length) utility++;
      for(const color of bestProduced) counts[color]=(counts[color]||0)+1;
    }
    return selected;
  }
  classify(card) {
    for (const role of ['ramp','draw','removal','wipe','protection','finisher'])
      if(SEED_SET[role]?.has(normalized(card))) return role;
    for (const role of ['ramp','draw','removal','wipe','protection','finisher']) if(roleMatch(card,role)) return role;
    return 'synergy';
  }
  /** Keep roles, favorite cards and singleton rules while steering the 62 spells toward a target curve. */
  rebalanceCurve(spells, spellPool, pinnedNames, target, req, terms, variant, plan=null, commander={}) {
    if (target === null) return spells;
    const goal=spells.length*target;
    let sum=spells.reduce((n,[card])=>n+card.cmc,0);
    const taken=new Set(spells.map(([card])=>normalized(card)));
    // Preserve each role and always prefer the closest feasible curve, not an invented claim of exactness.
    for(let pass=0;pass<70 && Math.abs(sum-goal)>0.05;pass++) {
      let best=null;
      let bestGain=0;
      for(let i=0;i<spells.length;i++) {
        const [previous,role]=spells[i];
        if(pinnedNames.has(normalized(previous))) continue;
        const oldTheme=themeScore(previous,req.creature_types,terms);
        const before=Math.abs(sum-goal);
        for(const option of spellPool) {
          if (taken.has(normalized(option)) || option.land || !roleMatch(option,role)) continue;
          const nextSum=sum-previous.cmc+option.cmc;
          const improved=before-Math.abs(nextSum-goal);
          if(improved<=0) continue;
          const newTheme=themeScore(option,req.creature_types,terms);
          const oldStructure=synergyFeatures(previous,plan,req.creature_types,commander).score;
          const nextStructure=synergyFeatures(option,plan,req.creature_types,commander).score;
          if(role==='synergy' && (oldTheme>=5 && newTheme===0 || oldStructure>=6 && nextStructure<6)) continue;
          const thematicLoss=Math.max(0,oldTheme-newTheme)*.035;
          const qualityLoss=Math.max(0,cardScore(previous,role,oldTheme,variant)-cardScore(option,role,newTheme,variant))*.013;
          const gain=improved-thematicLoss-qualityLoss-Math.max(0,oldStructure-nextStructure)*.065;
          if(gain>bestGain+0.00001){ bestGain=gain;best={i,option,nextSum,previous,role}; }
        }
      }
      if(!best) break;
      taken.delete(normalized(best.previous));
      taken.add(normalized(best.option));
      spells[best.i]=[best.option,best.role];
      sum=best.nextSum;
    }
    return spells;
  }
  async build(req,commander,favorites,profile,variant,pool) {
    const [title,description,targets]=profile;
    const [spellPool,landPool,terms,plan]=pool;
    const structure=card=>synergyFeatures(card,plan,req.creature_types,commander).score;
    const quality=(card,role)=>cardScore(card,role,themeScore(card,req.creature_types,terms),variant,structure(card),Boolean(plan||req.creature_types.length));
    const selected=[];
    const taken=new Set([normalized(commander)]);
    const defaultBasics=new Set(Object.values(BASICS).map(lower));
    const basicFavorites=new Set();
    const warnings=[];
    const pinnedNames=new Set();
    for(const card of favorites) {
      if(normalized(card)===normalized(commander)) continue;
      if(!withinIdentity(card,commander)) throw new DeckInputError(card.name+' is outside '+commander.name+'’s color identity.');
      if(card.basic && defaultBasics.has(normalized(card)) && (card.name==='Wastes' ? commander.color_identity.length===0 : true)) {
        basicFavorites.add(normalized(card));
        continue; // Ordinary basics are accounted for in the final basic-land quantities.
      }
      pinnedNames.add(normalized(card));
      if(taken.has(normalized(card))) continue;
      selected.push([card,card.land?'land':this.classify(card)]);
      taken.add(normalized(card));
    }
    const pinnedLands=selected.filter(([,r])=>r==='land').map(([c])=>c);
    let spells=selected.filter(([,r])=>r!=='land');
    const counted=Object.fromEntries(ROLE_ORDER.map(r=>[r,spells.filter(([,role])=>r===role).length]));
    let available=spellPool.filter(c=>!taken.has(normalized(c)) && withinIdentity(c,commander));
    const unfilled=[];
    for(const role of ROLE_ORDER) {
      const need=Math.max(0,targets[role]-(counted[role]||0));
      const matching=available.filter(c=>roleMatch(c,role));
      matching.sort((a,b)=>quality(b,role)-quality(a,role));
      const additions=matching.slice(0,need);
      if(additions.length<need) unfilled.push(role);
      for(const c of additions){spells.push([c,role]);taken.add(normalized(c));counted[role]++;}
      available=available.filter(c=>!taken.has(normalized(c)));
    }
    if(spells.length<62) {
      available.sort((a,b)=>quality(b,'synergy')-quality(a,'synergy'));
      for(const c of available.slice(0,62-spells.length)) {spells.push([c,'synergy']);taken.add(normalized(c));}
    }
    if(spells.length<62) throw new DeckInputError('Not enough distinct legal spells for a complete deck. Try broader inputs.');
    if(spells.length>62) {
      const pinned=spells.filter(([c])=>pinnedNames.has(normalized(c)));
      const extra=spells.filter(([c])=>!pinnedNames.has(normalized(c)));
      spells=[...pinned,...extra.slice(0,62-pinned.length)];
    }
    spells=this.rebalanceCurve(spells,spellPool.filter(c=>withinIdentity(c,commander)),pinnedNames,req.target_cmc,req,terms,variant,plan,commander);
    const targetLands=({0:17,1:11,2:19,3:24,4:26,5:28}[commander.color_identity.length] || 17) + (variant===3?1:0);
    const needNonbasic=Math.max(0,targetLands-pinnedLands.length);
    const nonbasics=this.pickNonbasics(landPool,commander,variant,needNonbasic,taken);
    if(pinnedLands.length+nonbasics.length>37) throw new DeckInputError('Too many nonbasic lands selected.');
    const main=[...spells,...[...pinnedLands,...nonbasics].map(c=>[c,'land'])];
    const colors=commander.color_identity.length?commander.color_identity:['C'];
    const sourceCount=Object.fromEntries(colors.map(c=>[c,0]));
    for(const land of [...pinnedLands,...nonbasics])
      for(const color of new Set(land.produced_mana)) if(colors.includes(color)) sourceCount[color]++;
    const weights=Object.fromEntries(colors.map(c=>[c,Math.max(1,9-sourceCount[c])]));
    const basicNeeded=37-pinnedLands.length-nonbasics.length;
    const amounts=Object.fromEntries(colors.map(color=>[color,basicNeeded>=colors.length?1:0]));
    for(let i=Object.values(amounts).reduce((a,b)=>a+b,0);i<basicNeeded;i++) {
      const choice=colors.reduce((best,c)=>weights[c]/(1+amounts[c])>weights[best]/(1+amounts[best])?c:best,colors[0]);
      amounts[choice]++;
    }
    const basicData=await this.getBasics();
    const basics=colors.filter(c=>amounts[c]).map(c=>[basicData[c],amounts[c]]);
    for(const requested of basicFavorites) {
      if(!basics.some(([c])=>normalized(c)===requested)) throw new DeckInputError('Could not include requested basic land: '+requested);
    }
    const themeHits=spells.filter(([c])=>themeScore(c,req.creature_types,terms)>=2).length;
    const cohesion=cohesionReport(spells.map(([c])=>c),plan,req.creature_types,commander);
    warnings.push(...cohesion.warnings);
    const intent=Boolean(req.creature_types.length||req.keywords.length||terms.length);
    const fraction=themeHits/62;
    if(intent&&fraction<.33) warnings.push('Theme support is thin: relatively few cards match the requested mechanics or creature types.');
    if(unfilled.length) warnings.push('Some ideal role slots lacked clear matches: '+unfilled.map(r=>ROLE_LABELS[r]).join(', ')+'.');
    if(nonbasics.length<needNonbasic) warnings.push('Limited nonbasic land choices; the mana base relies more heavily on basics.');
    if(!intent) warnings.push('No clear theme was given or inferred; this is a broad shell rather than a tuned strategy.');
    const avgCmc=averageSpellManaValue(spells.map(([card])=>card));
    if(req.target_cmc!==null && Math.abs(avgCmc-req.target_cmc)>0.2)
      warnings.push(`Target mana value ${req.target_cmc.toFixed(1)} could not be closely met; achieved ${avgCmc.toFixed(2)} with legal cards and required favorites.`);
    if(avgCmc>4.2) warnings.push('High mana curve may make early turns inconsistent.');
    let score=88;
    score-=intent?Math.round(Math.max(0,.45-fraction)*60):18;
    score-=Math.min(25,unfilled.length*7);
    score-=Math.max(0,needNonbasic-nonbasics.length)*2;
    score-=Math.max(0,avgCmc-3.5)*7;
    if(plan||req.creature_types.length) score-=Math.round((100-cohesion.score)*.30);
    if(req.target_cmc!==null) score-=Math.max(0,Math.abs(avgCmc-req.target_cmc)-0.15)*12;
    score=Math.max(0,Math.min(95,Math.round(score)));
    const confidence=score>=78?'High':score>=61?'Medium':'Low';
    if(confidence==='Low') warnings.unshift('Low-confidence build: theme fit or card availability may make this deck underperform.');
    const built={commander,main,basics,title,description,confidence,score,warnings,themeHits,avgCmc,targetCmc:req.target_cmc,cohesion};
    validateDeck(built);
    return deckView(built);
  }
  async generate(request,onProgress=()=>{}) {
    const prompt=String(request.prompt||'').trim();
    if(prompt.length>800) throw new DeckInputError('The deck description must be 800 characters or fewer.');
    const interpreted=interpretPrompt(prompt);
    const unique = (explicit, inferred, max) => [...new Map([...explicit,...inferred].map(value=>[lower(value),cleanTerm(value)])).values()].filter(Boolean).slice(0,max);
    const target=request.target_cmc===null || request.target_cmc===undefined || request.target_cmc==='' ? null : Number(request.target_cmc);
    const req={
      colors:(request.colors||[]).map(c=>String(c).trim().toUpperCase()),
      creature_types:unique(request.creature_types||[],interpreted.creature_types,3),
      keywords:unique(request.keywords||[],interpreted.keywords,5),
      prompt, target_cmc:target,
      commander:String(request.commander||'').trim(),
      favorites:(request.favorites||[]).map(name=>String(name).trim()).filter(Boolean),
      options:Number(request.options||4)
    };
    if(new Set(req.colors).size!==req.colors.length || req.colors.some(c=>!COLORS.includes(c)||c.length!==1))
      throw new DeckInputError('Colors must be unique choices from W, U, B, R, and G.');
    if(req.target_cmc!==null && (!Number.isFinite(req.target_cmc) || req.target_cmc<1.5 || req.target_cmc>5.5))
      throw new DeckInputError('Target average mana value must be between 1.5 and 5.5.');
    if(req.favorites.length>5 || !Number.isInteger(req.options) || req.options<1 || req.options>4)
      throw new DeckInputError('Enter up to five favorites and request between one and four decks.');
    onProgress('Looking up must-have cards and checking legality…');
    const favorites=await this.getFavorites(req);
    onProgress('Finding the best Commander candidates…');
    const choices=await this.commanders(req,favorites);
    const commanders=req.commander?Array(req.options).fill(choices[0]):choices;
    const cache=new Map();
    const decks=[];
    for(let i=0;i<commanders.length;i++) {
      const commander=commanders[i];
      onProgress(`Building ${i+1} of ${commanders.length}: ${commander.name}. Checking legal cards and mana base…`);
      const key=identity(commander.color_identity)+'|'+req.creature_types.join(',')+'|'+req.keywords.join(',')+'|'+(req.keywords.length?'':commander.oracle_text);
      if(!cache.has(key)) cache.set(key,await this.pool(req,commander));
      decks.push(await this.build(req,commander,favorites,PROFILES[i],i,cache.get(key)));
    }
    if(prompt && !interpreted.creature_types.length && !interpreted.keywords.length && !request.creature_types?.length && !request.keywords?.length) {
      for(const deck of decks) deck.warnings.push('The free-text request did not match recognized creature types or themes; add specific keywords for a closer fit.');
    }
    return decks;
  }
}

function cardView(card, quantity=1) {
  return {name:card.name,quantity,mana_cost:card.mana_cost,cmc:card.cmc,type:card.type_line,
    oracle_text:card.oracle_text || '',keywords:card.keywords || [],power:card.power || '',toughness:card.toughness || '',
    image:card.image,url:card.url,color_identity:card.color_identity};
}
function deckView(deck) {
  const grouped=Object.fromEntries(Object.keys(ROLE_LABELS).map(role=>[role,[]]));
  for(const [card,role] of deck.main) grouped[role].push(cardView(card));
  for(const [basic,quantity] of deck.basics) grouped.land.push(cardView(basic,quantity));
  const groups=Object.keys(ROLE_LABELS).filter(role=>grouped[role].length).map(role=>({
    role:ROLE_LABELS[role], cards:grouped[role].sort((a,b)=>a.name.localeCompare(b.name))
  }));
  const exportText='// Commander\n1 '+deck.commander.name+'\n\n// Deck\n'+
    groups.flatMap(group=>group.cards.map(card=>card.quantity+' '+card.name)).join('\n')+'\n';
  return {name:deck.commander.name+' — '+deck.title,commander:cardView(deck.commander),description:deck.description,
    confidence:deck.confidence,quality_score:deck.score,warnings:deck.warnings,theme_cards:deck.themeHits,
    groups,cohesion:deck.cohesion,average_cmc:Number(deck.avgCmc.toFixed(2)),target_cmc:deck.targetCmc,
    total_cards:1+groups.reduce((sum,g)=>sum+g.cards.reduce((n,c)=>n+c.quantity,0),0), export:exportText};
}
const shared=new BrowserGenerator();
export async function generateDecks(request,onProgress) {return shared.generate(request,onProgress);}
