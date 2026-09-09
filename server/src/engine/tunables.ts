/**
 * Every balance constant in the simulation, in one place.
 *
 * These were previously scattered as literals through the behaviour code,
 * which made balancing a matter of hunting through `agents.ts` for a number
 * whose meaning you had to infer from context. Grouping them here means a
 * tuning pass is a diff against one file, and each value can carry the
 * reasoning behind it.
 *
 * Changing anything here changes emergent behaviour. `npm run check` asserts
 * that the world still holds together afterwards.
 */
export const TUNABLES = {
  /** Drives that push an agent to act, per tick. */
  needs: {
    hungerPerTick: 0.78,
    thirstPerTick: 1.25,
    staminaRegenPerTick: 1.2,
    /** Hardiness reduces how fast needs accumulate, up to this fraction. */
    hardinessNeedsRelief: 0.35,
    /** Hardiness reduces damage taken from unmet needs, up to this fraction. */
    hardinessDamageRelief: 0.5,
    /** Below this stamina an agent must rest before doing anything else. */
    exhaustedStamina: 12,
    restStaminaRegen: 6,
    /** Thirst above this sends the agent looking for water. */
    thirstSeekThreshold: 52,
    /** Hunger above this interrupts everything else to eat. */
    hungerSeekThreshold: 40,
  },

  water: {
    /** Most an agent drinks from one tile in a tick. */
    drinkAmount: 45,
    /** Thirst removed per unit drunk. */
    thirstPerUnit: 1.6,
    /** A tile with less than this is not worth drinking from. */
    minDrinkable: 1,
    /** Only tiles above this are worth walking to. */
    minWorthwhile: 8,
    seekRadius: 14,
  },

  foraging: {
    /** Flint tools multiply gathering yield. */
    toolYieldBonus: 1.55,
    /** Cooking extracts more calories from the same catch. */
    cookingCalorieBonus: 1.25,
    huntYieldBonus: 1.6,
    fishYieldBonus: 1.3,
    /** Base food taken from a tile per tick, before bonuses. */
    baseTakePerTick: 3.4,
    /** Below this a tile is considered picked clean. */
    minTileFood: 1.5,
    /** Food units that satisfy one point of hunger. */
    caloriesPerHungerPoint: 3.2,
    /** Chance per hunting tick of being injured by the quarry. */
    huntInjuryChance: 0.012,
    huntInjuryMin: 8,
    huntInjuryMax: 30,
    seekRadius: 12,
    minWorthwhile: 6,
    /** Most food an agent hauls before returning to camp. */
    carryCapacity: 20,
    /** Fraction of capacity that triggers a trip home. */
    depositAtFraction: 0.6,
  },

  /**
   * How eagerly a tribe stocks its communal store.
   *
   * The share of the tribe that goes gathering rises smoothly as the store
   * falls. A hard threshold here made whole tribes flip between all-foraging
   * and none from one tick to the next.
   */
  surplus: {
    comfortableStorePerHead: 14,
    /** Baseline share still gathering even when comfortable. */
    urgeMin: 0.22,
    urgeMax: 0.92,
    /** urge = urgeBase - (store / comfortable), then clamped. */
    urgeBase: 1.05,
    /** Beyond this multiple of comfortable, gathering all but stops. */
    abundanceRatio: 2.5,
    abundanceUrge: 0.05,
  },

  warmth: {
    shelterBonus: 12,
    fireBonus: 9,
    /** Multiplied by the agent's hardiness trait. */
    hardinessBonus: 8,
    /** Effective warmth below this sends an agent to shelter. */
    seekShelterBelow: 4,
    /** Below this, exposure starts costing health. */
    damageBelow: 0,
    damageRate: 0.35,
    shelterStaminaRegen: 3,
    shelterMoraleGain: 0.4,
  },

  work: {
    buildChance: 0.25,
    craftChance: 0.2,
    cultivateChance: 0.15,
    craftStoneCost: 4,
    craftToolYield: 0.6,
    craftFromStoreCost: 6,
    craftFromStoreYield: 1,
    stoneSeekRadius: 10,
    minTileStone: 12,
    woodHarvest: 6,
    cultivateWoodCost: 10,
    hutWoodCost: 24,
    woodSeekRadius: 10,
    minTileWood: 20,
    depositMoraleGain: 1,
    socialiseMoraleGain: 0.6,
    /** Research contributed per socialising tick, times curiosity. */
    socialiseResearch: 0.5,
    /** Exploration ranges this far around the camp, never further. */
    exploreRadius: 14,
  },

  mortality: {
    starvationThreshold: 82,
    starvationRate: 0.22,
    dehydrationThreshold: 86,
    dehydrationRate: 0.4,
    sicknessDamage: 1.7,
    /** Health lost per year lived past elderhood. */
    elderDecayRate: 0.035,
    recoveryHungerBelow: 30,
    recoveryThirstBelow: 40,
    recoveryRate: 0.5,
    /** Per-tick chance of dying once past the maximum age. */
    oldAgeDeathChance: 0.05,
  },

  movement: {
    /** Stamina spent per step, times the tile's movement cost. */
    staminaPerStep: 1.6,
    /** An agent will not step onto a tile costing more than stamina/this. */
    staminaSafetyFactor: 2,
  },

  /** Heritable trait distribution. */
  genetics: {
    /** Mean and spread of a trait rolled fresh, with no parents. */
    freshMean: 0.5,
    freshSpread: 0.17,
    /** Mutation applied on top of the parental average. */
    mutationSpread: 0.07,
  },

  behaviour: {
    /** Chance an unskilled agent tries fishing rather than foraging. */
    opportunisticFishChance: 0.4,
    /** Aggression above which an agent prefers hunting to gathering. */
    hunterAggression: 0.4,
    /** Split of idle time between exploring and socialising. */
    exploreOverSocialise: 0.4,
  },

  reproduction: {
    /** An agent must be at least this healthy to consider it. */
    minHealth: 60,
    maxHunger: 40,
    /** Store must exceed population times this before courting begins. */
    storePerHeadRequired: 4,
  },
  /** Tribe-level growth, land and social structure. */
  tribe: {
    /** Claim radius grows with population: base + sqrt(pop) * factor, capped. */
    territoryRadiusBase: 3,
    territoryRadiusPerSqrtPop: 1.5,
    territoryRadiusMax: 18,
    /** Fraction of claimed carrying capacity a tribe can actually sustain. */
    carryingCapacityFactor: 0.12,
    capacityBonusFarming: 0.5,
    capacityBonusShelter: 0.3,
    capacityBonusFire: 0.15,
    /** Communal stores spoil at this rate per tick. */
    storeSpoilagePerTick: 0.995,
    /** Food per head below which a tribe accumulates hardship. */
    hardshipFoodPerHead: 4,
  },

  /** Feeding people from the communal store. */
  rationing: {
    /** Only agents hungrier than this are fed. */
    hungerThreshold: 25,
    /** Fed down to this hunger level. */
    targetHunger: 20,
    /** Only agents within this distance of camp can reach the store. */
    campRadius: 12,
    /** Most one agent may take from the store in a tick. */
    maxServing: 6,
  },

  research: {
    /** Research per adult per tick, times that adult's curiosity. */
    perAdultPerTick: 0.3,
    /** Multiplier while the tribe is comfortably fed. */
    wellFedBonus: 1.4,
    /** Store per head above which the tribe counts as well fed. */
    wellFedStorePerHead: 4,
    /** Warfare is pulled forward by this much while a tribe is at war. */
    wartimeWarfareBias: 3000,
    /** Share of a technology's cost that diffuses along a trade route. */
    tradeDiffusionRate: 0.02,
  },

  birth: {
    /** Food spent from the store per child. */
    foodCost: 14,
    /** Base chance a willing pair conceives in a tick. */
    baseChance: 0.32,
    /** Extra chance from abundance, capped. */
    abundanceBonusMax: 0.3,
    abundanceDivisorPerHead: 40,
    /** Parents must be within this distance of each other. */
    pairDistance: 6,
    /** Share of newborns lost immediately. */
    infantMortality: 0.12,
    fatherCooldownYears: 0.8,
    motherCooldownYears: 1.6,
  },

  migration: {
    /** Hardship above which a tribe relocates its camp. */
    relocateStress: 40,
    relocateSearchRadius: 26,
    relocateMinFoodCap: 30,
    relocateWaterRadius: 4,
    /**
     * Ceiling on hardship, as a multiple of the relocation threshold.
     *
     * Hardship feeds war pressure as (A + B) / scarcityDivisor. Uncapped, a
     * tribe boxed in for long enough would eventually be at permanent war with
     * every neighbour on the strength of the counter alone, regardless of any
     * actual scarcity.
     */
    stressCeilingMultiple: 2,
    /**
     * How far the relocation filter relaxes at maximum desperation.
     *
     * A tribe with nowhere good to go should take marginal land rather than
     * accumulate a number for ever — which is what people boxed in on poor
     * ground actually did.
     */
    desperationFoodRelief: 0.6,
    desperationWaterRadiusBonus: 4,
    desperationSearchBonus: 1,
    /** Population at which a tribe may bud off a daughter. */
    fissionPopulation: 60,
    fissionChance: 0.045,
    /**
     * Share of its land's carrying capacity a tribe must be pressing before it
     * splits at all.
     *
     * Size alone used to be the whole trigger, so a thriving tribe on rich land
     * budded off daughters just as readily as one running out of room. Groups
     * split because the land will not hold them, not merely because they are
     * numerous.
     */
    fissionCapacityRatio: 0.6,
    /**
     * Years a tribe must wait after founding, or after splitting, before it may
     * split again. Without this a large tribe shed daughters back to back.
     */
    fissionCooldownYears: 8,
    fissionSearchRadius: 34,
    fissionMinDistance: 12,
    fissionMinFoodCap: 26,
    fissionWaterRadius: 5,
    /** Share of the parent's stores that leaves with the splinter band. */
    fissionFoodShare: 0.3,
    /**
     * Share of the parent's *working-age adults* that leaves.
     *
     * Deliberately a share of adults, not of total population: this world runs
     * bottom-heavy, so a share of the whole population routinely exceeds the
     * entire adult count and would strip the parent of every person able to
     * craft, build, fight or reproduce.
     */
    fissionMoverShare: 0.35,
    /** Below this many movers the band is not viable and fission is skipped. */
    fissionMinMovers: 4,
    /** Progress a splinter retains, and its chance of keeping each technique. */
    fissionKnowledgeRetained: 0.6,
    fissionTechRetainChance: 0.7,
  },

  diplomacy: {
    /** Beyond this distance two tribes ignore each other. */
    contactDistance: 34,
    /** Weights that combine into war pressure. */
    aggressionWeight: 0.5,
    scarcityDivisor: 80,
    contestedDivisor: 40,
    proximityDistance: 16,
    proximityBonus: 0.3,
    contestedRadius: 14,
    /** Pressure above which war may be declared, and the per-check chance. */
    warThreshold: 1.35,
    warChance: 0.05,
    /** Pressure below which tribes may open trade. */
    tradeThreshold: 0.7,
    tradeChance: 0.03,
    /** Per-check chance an ongoing war simply ends. */
    peaceChance: 0.008,
    /** A side this small ends the war. */
    exhaustedPopulation: 6,
    peaceCooldownYears: 2,
    /** Chance per check that trading partners actually exchange goods. */
    tradeRunChance: 0.2,
    /** Store per head kept back before anything counts as surplus. */
    tradeReservePerHead: 6,
    tradeSurplusThreshold: 20,
    tradeFraction: 0.3,
    tradeFoodCap: 40,
    tradeFoodPerTool: 8,
    /** Knowledge and morale outcomes of subjugation. */
    subjugationKnowledgeRetained: 0.8,
    subjugationMoralePenalty: 25,
    /** A tribe this small next to one this much larger is absorbed. */
    conquestPopulation: 8,
    conquestRatio: 3,
  },

  combat: {
    /** Share of eligible adults mobilised, with and without warfare tech. */
    mobilisationShare: 0.28,
    mobilisationShareWithWarfare: 0.45,
    minHealthToFight: 45,
    maxHungerToFight: 70,
    /** Base damage exchanged in a melee. */
    swingDamage: 26,
    /** Damage the winner still takes, as a fraction of a swing. */
    winnerDamageFraction: 0.28,
    toolAdvantage: 0.6,
    aggressionFloor: 0.6,
    warfareTechAdvantage: 1.45,
    palisadeAdvantage: 1.3,
    rollMin: 0.7,
    rollMax: 1.3,
    staminaPerAdvance: 2,
    minStaminaToAdvance: 6,
    /** Casualties on one front before a skirmish is worth logging. */
    reportThreshold: 3,
  },

  climate: {
    /** Mean temperature and the amplitude of the seasonal swing. */
    baseTemperature: 13,
    seasonalAmplitude: 17,
    /** Plant growth multiplier: base + temperature / divisor, clamped. */
    growthBase: 0.35,
    growthTemperatureDivisor: 22,
    growthMax: 1.6,
    /** Growth once the temperature is at or below freezing. */
    growthFrozen: 0.15,
    /** Deaths from one cause before the log reports them. */
    deathReportThreshold: 4,
  },

  disasters: {
    longWinterTemperatureDrop: 16,
    famineHungerMultiplier: 0.9,
    famineFoodRemaining: 0.4,
    pestilenceInfectionChance: 0.06,
    sicknessMinTicks: 10,
    sicknessMaxTicks: 40,
    blessingRegenMultiplier: 8,
    curseRegenMultiplier: 0.05,
    curseCapMultiplier: 0.25,
  },
} as const;
