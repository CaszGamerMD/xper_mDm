/** Shared, transparent archetype heuristics. These measure structural synergy, not true combo/rules simulation. */
const lc = value => String(value || '').toLowerCase();
export const PLANS = {
  blink: {label:'Blink / ETB value', enabler:[/exile (another |up to |target |one |any number of )?(creature|permanent)/,/return .* to (the )?battlefield/,/flicker/], payoff:[/whenever .* enters( the battlefield)?/,/when .* enters( the battlefield)?/,/enters the battlefield.*(draw|create|destroy|exile|return)/]},
  aristocrats:{label:'Sacrifice / death value', enabler:[/sacrifice (a|another|any number of|target) /,/sacrifice a creature:/,/create .* creature token/],payoff:[/whenever .* (dies|is put into a graveyard|sacrifice)/,/whenever you sacrifice/,/whenever a creature .*dies/] },
  tokens:{label:'Token engine / go wide',enabler:[/create .* token/,/populate/,/creature tokens?/],payoff:[/whenever .*token/,/creatures you control get/,/for each creature you control/,/whenever .* creature enters/] },
  landfall:{label:'Landfall engine',enabler:[/put .*land .* onto the battlefield/,/play an additional land/,/search your library for .*land/,/return .*land .* to (its|your) owner's hand/],payoff:[/landfall/,/whenever a land enters/,/whenever .* land .* enters/] },
  spellslinger:{label:'Spells matter',enabler:[/copy target (instant|sorcery)/,/instant or sorcery spell/,/cast .* (instant|sorcery)/],payoff:[/whenever you cast .* (instant|sorcery|noncreature)/,/magecraft/,/prowess/,/whenever .*cast.* spell/] },
  storm:{label:'Storm / spell chaining',enabler:[/add \{/,/untap .* (land|permanent)/,/copy .*spell/,/costs? \{1\} less to cast/],payoff:[/storm/,/whenever you cast .*spell/,/whenever .*instant or sorcery/] },
  reanimator:{label:'Graveyard recursion',enabler:[/mill [a-z0-9x]/,/discard .*card/,/put .* from .*library into .*graveyard/,/sacrifice .*creature/],payoff:[/return .* from (a|your|any) graveyard to the battlefield/,/put .*creature card from .*graveyard onto the battlefield/,/reanimate/] },
  counters:{label:'Counters / proliferate',enabler:[/put .* counter on/,/enters .*counter/,/move .*counter/],payoff:[/proliferate/,/for each .*counter/,/whenever .* counter/,/double .* counters/] },
  '1/1 counters':{label:'Counters / proliferate',enabler:[/put .* counter on/,/enters .*counter/],payoff:[/proliferate/,/for each .*counter/,/whenever .*counter/] },
  '+1/+1 counters':{label:'Counters / proliferate',enabler:[/put .* counter on/,/enters .*counter/],payoff:[/proliferate/,/for each .*counter/,/whenever .*counter/] },
  mill:{label:'Mill / graveyard payoff',enabler:[/target player mills?/,/each opponent mills?/,/mills? [0-9x]/],payoff:[/whenever .*card .*graveyard/,/for each card in .*graveyard/,/cards? in .* graveyard/] },
  artifacts:{label:'Artifact engine',enabler:[/create .* (artifact|treasure|clue|food)/,/artifact spells?/,/search .*artifact/],payoff:[/whenever .*artifact .*enters/,/artifacts? you control/,/whenever you cast .*artifact/] },
  enchantments:{label:'Enchantress',enabler:[/enchantment spell/,/enchantment card/,/aura spell/],payoff:[/whenever .*enchantment (enters|spell)/,/constellation/,/for each enchantment/] },
  lifegain:{label:'Life gain engine',enabler:[/you gain [0-9x] life/,/gain that much life/,/lifelink/],payoff:[/whenever you gain life/,/whenever .* life .*gain/,/if you would gain life/] },
  voltron:{label:'Commander damage / equipment',enabler:[/equip \{/,/attach .* to target/,/enchanted creature gets/,/equipped creature gets/],payoff:[/whenever .* attacks/,/commander .* damage/,/double strike/,/hexproof/,/indestructible/] },
  treasure:{label:'Treasure engine',enabler:[/create .*treasure/,/treasure token/],payoff:[/whenever .*artifact .*enters/,/sacrifice an artifact/,/whenever you sacrifice .*treasure/] },
  discard:{label:'Discard engine',enabler:[/target .* discards?/,/each .* discards?/,/discard a card/],payoff:[/whenever .*discards?/,/madness/,/opponent .*discard/] },
  infect:{label:'Poison / proliferate',enabler:[/infect/,/toxic [0-9]/,/poison counter/],payoff:[/proliferate/,/poison counter/,/corrupted/] }
};
export const THEME_SEARCHES={
  blink:['o:"exile" o:"return"','o:"whenever" o:"enters"'],
  aristocrats:['o:"sacrifice a creature"','o:"whenever" o:"dies"'],
  tokens:['o:"create" o:"creature token"','o:"whenever" o:"creature enters"'],
  landfall:['o:"landfall"','o:"play an additional land"'],
  spellslinger:['o:"whenever you cast" o:"instant or sorcery"','o:"magecraft"'],
  storm:['o:"storm"','o:"whenever you cast" o:"spell"'],
  reanimator:['o:"graveyard" o:"battlefield"','o:"mill"'],
  counters:['o:"proliferate"','o:"+1/+1 counter"'],
  mill:['o:"mill"','o:"graveyard"'],
  artifacts:['o:"artifact" o:"enters"','o:"create" o:"artifact token"'],
  enchantments:['o:"constellation"','o:"enchantment" o:"draw"'],
  lifegain:['o:"whenever you gain life"','o:"lifelink"'],
  voltron:['o:"equipment" o:"equipped"','o:"whenever" o:"attacks"'],
  treasure:['o:"treasure"','o:"sacrifice an artifact"'],
  discard:['o:"whenever" o:"discards"','o:"discard a card"'],
  infect:['o:"proliferate"','o:"infect"']
};
const ALIAS={flicker:'blink',sacrifice:'aristocrats',lands:'landfall','+1/+1 counters':'counters','1/1 counters':'counters'};
const normalizeTheme = value => ALIAS[lc(value)] || lc(value);
export function deckPlan(keywords=[], commander={}) {
  const oracle=lc(commander.oracle_text);
  const requested=keywords.map(normalizeTheme).filter(k=>PLANS[k]);
  if(requested.length) {
    // Favor user request, break ties by commander support.
    const scored=requested.map((key,index)=>[key,(oracle.match(new RegExp(key,'g'))||[]).length*2 +
      (PLANS[key].enabler.some(re=>re.test(oracle))?3:0)+(PLANS[key].payoff.some(re=>re.test(oracle))?3:0)-index*.2]);
    scored.sort((a,b)=>b[1]-a[1]);
    return scored[0][0];
  }
  const ranked=Object.keys(PLANS).filter(k=>!['1/1 counters','+1/+1 counters'].includes(k))
    .map(key=>[key,(PLANS[key].enabler.some(re=>re.test(oracle))?2:0)+(PLANS[key].payoff.some(re=>re.test(oracle))?3:0)+
      (oracle.includes(key)?2:0)]).sort((a,b)=>b[1]-a[1]);
  return ranked[0]?.[1]>0?ranked[0][0]:null;
}
export function synergyFeatures(card, plan, creatureTypes=[], commander={}) {
  const t=lc(card.oracle_text); const typ=lc(card.type_line);const command=lc(commander.oracle_text);
  const shape=PLANS[normalizeTheme(plan)];
  const tribalPayoff=creatureTypes.some(type=>t.includes(lc(type)) && (/you control|whenever|creature spells?|gets? \+|other creatures/i.test(t)));
  const tribalPlan=!shape && creatureTypes.length>0;
  const tribe=creatureTypes.some(type=>{
    const w=lc(type);return typ.includes(w) && /\bcreature\b/.test(typ) || t.includes(w);
  });
  const enabler=Boolean(shape?.enabler.some(re=>re.test(t)));
  const payoff=Boolean(shape?.payoff.some(re=>re.test(t)) || (tribalPlan && tribalPayoff));
  const leaderSupport=Boolean(command && (
    (tribe && creatureTypes.length) ||
    (/\bcreature\b/.test(command) && /\bcreature\b/.test(typ) && /whenever .*creature/.test(command)) ||
    (/\binstant or sorcery\b/.test(command) && /\b(instant|sorcery)\b/.test(typ)) ||
    (/\bartifact\b/.test(command) && /\bartifact\b/.test(typ)) ||
    (/\benchantment\b/.test(command) && /\benchantment\b/.test(typ))
  ));
  const coherent = enabler || payoff || tribe || leaderSupport;
  return {tribe,enabler,payoff,leaderSupport,coherent,score:(enabler?6:0)+(payoff?8:0)+(tribe?8:0)+(leaderSupport?4:0)+(enabler&&payoff?4:0)};
}
export function cohesionReport(spells, plan, creatureTypes=[], commander={}) {
  const facts=spells.map(c=>synergyFeatures(c,plan,creatureTypes,commander));
  const enablers=facts.filter(f=>f.enabler||f.tribe).length;
  const payoffs=facts.filter(f=>f.payoff).length;
  const bridges=facts.filter(f=>f.coherent).length;
  const warnings=[];
  const intentional=Boolean(plan || creatureTypes.length);
  if(intentional && enablers<9) warnings.push('Engine lacks enough enablers ('+enablers+'); the plan may not start consistently.');
  if(intentional && payoffs<5) warnings.push('Engine has only '+payoffs+' clear payoffs; it may generate value without a win condition.');
  if(intentional && bridges<Math.ceil(spells.length*.35)) warnings.push('Only '+bridges+' of '+spells.length+' nonland cards clearly connect to the game plan.');
  const score=intentional?Math.round(Math.min(100,35* Math.min(enablers/14,1)+35*Math.min(payoffs/9,1)+30*Math.min(bridges/(spells.length*.52),1))):0;
  return {planKey:plan || (creatureTypes.length?'tribal':null),plan:PLANS[plan]?.label || (creatureTypes[0] ? creatureTypes.join('/')+' tribal' : 'General value'),
    enablers,payoffs,connected:bridges, score, warnings};
}
