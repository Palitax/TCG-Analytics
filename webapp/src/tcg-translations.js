/**
 * TCG German Localization & Dictionary Helper
 * Provides German card names, German set names, and metadata translation
 * across Pokémon, One Piece, Lorcana, Yu-Gi-Oh, and Dragon Ball.
 */

// Comprehensive Pokémon English -> German Name Dictionary
export const POKEMON_NAME_EN_TO_DE = {
  // Gen 1
  'Bulbasaur': 'Bisasam',
  'Ivysaur': 'Bisaknosp',
  'Venusaur': 'Bisaflor',
  'Charmander': 'Glumanda',
  'Charmeleon': 'Glutexo',
  'Charizard': 'Glurak',
  'Squirtle': 'Schiggy',
  'Wartortle': 'Schillok',
  'Blastoise': 'Turtok',
  'Caterpie': 'Raupy',
  'Metapod': 'Safcon',
  'Butterfree': 'Smettbo',
  'Weedle': 'Hornliu',
  'Kakuna': 'Kokuna',
  'Beedrill': 'Bibor',
  'Pidgey': 'Taubsi',
  'Pidgeotto': 'Tauboga',
  'Pidgeot': 'Tauboss',
  'Rattata': 'Rattfratz',
  'Raticate': 'Rattikarl',
  'Spearow': 'Habitak',
  'Fearow': 'Ibitak',
  'Ekans': 'Rettan',
  'Arbok': 'Arbok',
  'Pikachu': 'Pikachu',
  'Raichu': 'Raichu',
  'Sandshrew': 'Sandan',
  'Sandslash': 'Sandamer',
  'Nidoran♀': 'Nidoran♀',
  'Nidorina': 'Nidorina',
  'Nidoqueen': 'Nidoqueen',
  'Nidoran♂': 'Nidoran♂',
  'Nidorino': 'Nidorino',
  'Nidoking': 'Nidoking',
  'Clefairy': 'Piepi',
  'Clefable': 'Pixi',
  'Vulpix': 'Vulpix',
  'Ninetales': 'Vulnona',
  'Jigglypuff': 'Pummeluff',
  'Wigglytuff': 'Knuddeluff',
  'Zubat': 'Zubat',
  'Golbat': 'Golbat',
  'Oddish': 'Myrapla',
  'Gloom': 'Duflor',
  'Vileplume': 'Giflor',
  'Paras': 'Paras',
  'Parasect': 'Parasek',
  'Venonat': 'Bluzuk',
  'Venomoth': 'Omot',
  'Diglett': 'Digda',
  'Dugtrio': 'Digdri',
  'Meowth': 'Mauzi',
  'Persian': 'Snobilikat',
  'Psyduck': 'Enton',
  'Golduck': 'Entoron',
  'Mankey': 'Menki',
  'Primeape': 'Rasaff',
  'Growlithe': 'Fukano',
  'Arcanine': 'Arkani',
  'Poliwag': 'Quapsel',
  'Poliwhirl': 'Quaputzi',
  'Poliwrath': 'Quappo',
  'Abra': 'Abra',
  'Kadabra': 'Kadabra',
  'Alakazam': 'Simsala',
  'Machop': 'Machollo',
  'Machoke': 'Maschock',
  'Machamp': 'Machomei',
  'Bellsprout': 'Knofensa',
  'Weepinbell': 'Ultrigaria',
  'Victreebel': 'Sarzenia',
  'Tentacool': 'Tentacha',
  'Tentacruel': 'Tentoxa',
  'Geodude': 'Kleinstein',
  'Graveler': 'Georok',
  'Golem': 'Geowaz',
  'Ponyta': 'Ponita',
  'Rapidash': 'Gallopa',
  'Slowpoke': 'Flegmon',
  'Slowbro': 'Lahmus',
  'Magnemite': 'Magnetilo',
  'Magneton': 'Magneton',
  'Farfetch\'d': 'Porenta',
  'Doduo': 'Dodu',
  'Dodrio': 'Dodri',
  'Seel': 'Jurob',
  'Dewgong': 'Jugong',
  'Grimer': 'Sleima',
  'Muk': 'Sleimok',
  'Shellder': 'Muschas',
  'Cloyster': 'Austos',
  'Gastly': 'Nebulak',
  'Haunter': 'Alpollo',
  'Gengar': 'Gengar',
  'Onix': 'Onix',
  'Drowzee': 'Traumato',
  'Hypno': 'Hypno',
  'Krabby': 'Krabby',
  'Kingler': 'Kingler',
  'Voltorb': 'Voltobal',
  'Electrode': 'Lektrobal',
  'Exeggcute': 'Owei',
  'Exeggutor': 'Kokowei',
  'Cubone': 'Tragosso',
  'Marowak': 'Knogga',
  'Hitmonlee': 'Kicklee',
  'Hitmonchan': 'Nockchan',
  'Lickitung': 'Schlurp',
  'Koffing': 'Smogon',
  'Weezing': 'Smogmog',
  'Rhyhorn': 'Rihorn',
  'Rhydon': 'Rizeros',
  'Chansey': 'Chaneira',
  'Tangela': 'Tangela',
  'Kangaskhan': 'Kangama',
  'Horsea': 'Seeper',
  'Seadra': 'Seemon',
  'Goldeen': 'Goldini',
  'Seaking': 'Golking',
  'Staryu': 'Sterndu',
  'Starmie': 'Starmie',
  'Mr. Mime': 'Pantimos',
  'Scyther': 'Sichlor',
  'Jynx': 'Rossana',
  'Electabuzz': 'Eletek',
  'Magmar': 'Magmar',
  'Pinsir': 'Pinsir',
  'Tauros': 'Tauros',
  'Magikarp': 'Karpador',
  'Gyarados': 'Garados',
  'Lapras': 'Lapras',
  'Ditto': 'Ditto',
  'Eevee': 'Evoli',
  'Vaporeon': 'Aquana',
  'Jolteon': 'Blitza',
  'Flareon': 'Flamara',
  'Porygon': 'Porygon',
  'Omanyte': 'Amonitas',
  'Omastar': 'Amoroso',
  'Kabuto': 'Kabuto',
  'Kabutops': 'Kabutops',
  'Aerodactyl': 'Aerodactyl',
  'Snorlax': 'Relaxo',
  'Articuno': 'Arktos',
  'Zapdos': 'Zapdos',
  'Moltres': 'Lavados',
  'Dratini': 'Dratini',
  'Dragonair': 'Dragonir',
  'Dragonite': 'Dragoran',
  'Mewtwo': 'Mewtu',
  'Mew': 'Mew',

  // Gen 2
  'Chikorita': 'Endivie',
  'Bayleef': 'Lorblatt',
  'Meganium': 'Meganie',
  'Cyndaquil': 'Feurigel',
  'Quilava': 'Igelavar',
  'Typhlosion': 'Tornupto',
  'Totodile': 'Karnimani',
  'Croconaw': 'Tyracroc',
  'Feraligatr': 'Impergator',
  'Sentret': 'Wiesor',
  'Furret': 'Wiesenior',
  'Hoothoot': 'Hoothoot',
  'Noctowl': 'Noctuh',
  'Ledyba': 'Ledyba',
  'Ledian': 'Ledian',
  'Spinarak': 'Webarak',
  'Ariados': 'Ariados',
  'Crobat': 'Iksbat',
  'Chinchou': 'Lampi',
  'Lanturn': 'Lanturn',
  'Pichu': 'Pichu',
  'Cleffa': 'Pii',
  'Igglybuff': 'Fluffeluff',
  'Togepi': 'Togepi',
  'Togetic': 'Togetic',
  'Natu': 'Natu',
  'Xatu': 'Xatu',
  'Mareep': 'Voltilamm',
  'Flaaffy': 'Waaty',
  'Ampharos': 'Ampharos',
  'Bellossom': 'Blubella',
  'Marill': 'Marill',
  'Azumarill': 'Azumarill',
  'Sudowoodo': 'Mogelbaum',
  'Politoed': 'Quaxo',
  'Aipom': 'Griffel',
  'Sunkern': 'Sonnkern',
  'Sunflora': 'Sonnflora',
  'Yanma': 'Yanma',
  'Wooper': 'Felino',
  'Quagsire': 'Morlord',
  'Espeon': 'Psiana',
  'Umbreon': 'Nachtara',
  'Murkrow': 'Kramurx',
  'Slowking': 'Laschoking',
  'Misdreavus': 'Traunfugil',
  'Unown': 'Icognito',
  'Wobbuffet': 'Woingenau',
  'Girafarig': 'Girafarig',
  'Pineco': 'Tannza',
  'Forretress': 'Forstellka',
  'Dunsparce': 'Dummisel',
  'Gligar': 'Skorgla',
  'Steelix': 'Stahlos',
  'Snubbull': 'Snubbull',
  'Granbull': 'Granbull',
  'Qwilfish': 'Baldorfish',
  'Scizor': 'Scherox',
  'Shuckle': 'Pottrott',
  'Heracross': 'Skaraborn',
  'Sneasel': 'Sniebel',
  'Teddiursa': 'Teddiursa',
  'Ursaring': 'Ursaring',
  'Slugma': 'Schneckmag',
  'Magcargo': 'Magcargo',
  'Swinub': 'Quiekel',
  'Piloswine': 'Keifel',
  'Corsola': 'Corasonn',
  'Remoraid': 'Remoraid',
  'Octillery': 'Octillery',
  'Delibird': 'Botogel',
  'Mantine': 'Mantax',
  'Skarmory': 'Panzaeron',
  'Houndour': 'Hunduster',
  'Houndoom': 'Hundemon',
  'Kingdra': 'Seedraking',
  'Phanpy': 'Phanpy',
  'Donphan': 'Donphan',
  'Porygon2': 'Porygon2',
  'Stantler': 'Damhirplex',
  'Smeargle': 'Farbeagle',
  'Tyrogue': 'Rabauz',
  'Hitmontop': 'Kapoera',
  'Smoochum': 'Kussilla',
  'Elekid': 'Elekid',
  'Magby': 'Magby',
  'Miltank': 'Miltank',
  'Blissey': 'Heiteira',
  'Raikou': 'Raikou',
  'Entei': 'Entei',
  'Suicune': 'Suicune',
  'Larvitar': 'Larvitar',
  'Pupitar': 'Pupitar',
  'Tyranitar': 'Despotar',
  'Lugia': 'Lugia',
  'Ho-Oh': 'Ho-Oh',
  'Celebi': 'Celebi',

  // Gen 3
  'Treecko': 'Geckarbor',
  'Grovyle': 'Reptain',
  'Sceptile': 'Gewaldro',
  'Torchic': 'Flemmli',
  'Combusken': 'Jungglut',
  'Blaziken': 'Lohgock',
  'Mudkip': 'Hydropi',
  'Marshtomp': 'Moorabbel',
  'Swampert': 'Sumpex',
  'Ralts': 'Trasla',
  'Kirlia': 'Kirlia',
  'Gardevoir': 'Guardevoir',
  'Gallade': 'Galagladi',
  'Slakoth': 'Bummelz',
  'Vigoroth': 'Muntier',
  'Slaking': 'Letarking',
  'Ninjask': 'Ninjask',
  'Shedinja': 'Ninjatom',
  'Sableye': 'Zobiris',
  'Mawile': 'Flunkifer',
  'Aron': 'Stollunior',
  'Lairon': 'Stollrak',
  'Aggron': 'Stolloss',
  'Meditite': 'Meditie',
  'Medicham': 'Meditalis',
  'Manectric': 'Voltenso',
  'Sharpedo': 'Tohaido',
  'Wailord': 'Wailord',
  'Flygon': 'Libelldra',
  'Altaria': 'Altaria',
  'Milotic': 'Milotic',
  'Absol': 'Absol',
  'Salamence': 'Brutalanda',
  'Metagross': 'Metagross',
  'Regirock': 'Regirock',
  'Regice': 'Regice',
  'Registeel': 'Registeel',
  'Latias': 'Latias',
  'Latios': 'Latios',
  'Kyogre': 'Kyogre',
  'Groudon': 'Groudon',
  'Rayquaza': 'Rayquaza',
  'Jirachi': 'Jirachi',
  'Deoxys': 'Deoxys',

  // Gen 4
  'Turtwig': 'Chelast',
  'Grotle': 'Chelcarain',
  'Torterra': 'Chelterrar',
  'Chimchar': 'Panflam',
  'Monferno': 'Panpyro',
  'Infernape': 'Panferno',
  'Piplup': 'Plinfa',
  'Prinplup': 'Pliprin',
  'Empoleon': 'Impoleon',
  'Staraptor': 'Staraptor',
  'Luxray': 'Luxtra',
  'Roserade': 'Roserade',
  'Rampardos': 'Rameidon',
  'Vespiquen': 'Honweisel',
  'Floatzel': 'Bojelin',
  'Gastrodon': 'Gastrodon',
  'Drifblim': 'Drifzepeli',
  'Lopunny': 'Schlapfel',
  'Mismagius': 'Traunmagil',
  'Honchkrow': 'Kramshef',
  'Garchomp': 'Knakrack',
  'Lucario': 'Lucario',
  'Riolu': 'Riolu',
  'Hippowdon': 'Hippoterus',
  'Drapion': 'Piondragi',
  'Toxicroak': 'Toxiquak',
  'Abomasnow': 'Rexblisar',
  'Weavile': 'Snibunna',
  'Magnezone': 'Magnezone',
  'Rhyperior': 'Rihornior',
  'Tangrowth': 'Tangoloss',
  'Electivire': 'Elevoltek',
  'Magmortar': 'Magbrant',
  'Togekiss': 'Togekiss',
  'Yanmega': 'Yanmega',
  'Leafeon': 'Folipurba',
  'Glaceon': 'Glaziola',
  'Gliscor': 'Skorgro',
  'Mamoswine': 'Mamutel',
  'Porygon-Z': 'Porygon-Z',
  'Dusknoir': 'Zwirrfinst',
  'Froslass': 'Frosdedje',
  'Rotom': 'Rotom',
  'Uxie': 'Selfe',
  'Mesprit': 'Vesprit',
  'Azelf': 'Tobutz',
  'Dialga': 'Dialga',
  'Palkia': 'Palkia',
  'Heatran': 'Heatran',
  'Regigigas': 'Regigigas',
  'Giratina': 'Giratina',
  'Cresselia': 'Cresselia',
  'Phione': 'Phione',
  'Manaphy': 'Manaphy',
  'Darkrai': 'Darkrai',
  'Shaymin': 'Shaymin',
  'Arceus': 'Arceus',

  // Gen 5 - 9 Notable
  'Victini': 'Victini',
  'Snivy': 'Serpifeu',
  'Servine': 'Efoserp',
  'Serperior': 'Serpiroyal',
  'Tepig': 'Floink',
  'Pignite': 'Ferkokel',
  'Emboar': 'Flambirex',
  'Oshawott': 'Ottaro',
  'Dewott': 'Zwottronin',
  'Samurott': 'Admurai',
  'Excadrill': 'Stalobor',
  'Drilbur': 'Rotomurf',
  'Audino': 'Ohrdoch',
  'Conkeldurr': 'Meistagrif',
  'Seismitoad': 'Branawarz',
  'Krookodile': 'Rabigator',
  'Zoroark': 'Zoroark',
  'Zorua': 'Zorua',
  'Gothitelle': 'Morbitesse',
  'Reuniclus': 'Zytomega',
  'Chandelure': 'Skelabra',
  'Haxorus': 'Maxax',
  'Hydreigon': 'Trikephalo',
  'Volcarona': 'Ramoth',
  'Cobalion': 'Kobalium',
  'Terrakion': 'Terrakium',
  'Virizion': 'Viridium',
  'Tornadus': 'Boreos',
  'Thundurus': 'Voltolos',
  'Reshiram': 'Reshiram',
  'Zekrom': 'Zekrom',
  'Landorus': 'Demeteros',
  'Kyurem': 'Kyurem',
  'Keldeo': 'Keldeo',
  'Meloetta': 'Meloetta',
  'Genesect': 'Genesect',

  // Gen 6
  'Chespin': 'Igamaro',
  'Fennekin': 'Fynx',
  'Froakie': 'Froxy',
  'Frogadier': 'Amphizel',
  'Greninja': 'Quajutsu',
  'Talonflame': 'Fiaro',
  'Aegislash': 'Durengard',
  'Sylveon': 'Feelinara',
  'Goodra': 'Viscogon',
  'Xerneas': 'Xerneas',
  'Yveltal': 'Yveltal',
  'Zygarde': 'Zygarde',
  'Diancie': 'Diancie',
  'Hoopa': 'Hoopa',
  'Volcanion': 'Volcanion',

  // Gen 7
  'Rowlet': 'Bauz',
  'Dartrix': 'Arboretoss',
  'Decidueye': 'Silvarro',
  'Litten': 'Flamiau',
  'Torracat': 'Miezunder',
  'Incineroar': 'Fuegro',
  'Popplio': 'Robball',
  'Brionne': 'Marikeck',
  'Primarina': 'Primarene',
  'Vikavolt': 'Donarion',
  'Lycanroc': 'Wolwerock',
  'Wishiwashi': 'Lusardin',
  'Mudbray': 'Pampuli',
  'Mudsdale': 'Pampross',
  'Golisopod': 'Tectass',
  'Mimikyu': 'Mimigma',
  'Tapu Koko': 'Kapu-Riki',
  'Tapu Lele': 'Kapu-Fala',
  'Tapu Bulu': 'Kapu-Toro',
  'Tapu Fini': 'Kapu-Kime',
  'Solgaleo': 'Solgaleo',
  'Lunala': 'Lunala',
  'Necrozma': 'Necrozma',
  'Magearna': 'Magearna',
  'Marshadow': 'Marshadow',
  'Zeraora': 'Zeraora',

  // Gen 8
  'Grookey': 'Chimpep',
  'Thwackey': 'Chimstix',
  'Rillaboom': 'Gortrom',
  'Scorbunny': 'Hopplo',
  'Raboot': 'Kickerlo',
  'Cinderace': 'Liberlo',
  'Sobble': 'Memmeon',
  'Drizzile': 'Phlegleon',
  'Inteleon': 'Intelleon',
  'Corviknight': 'Krarmor',
  'Cramorant': 'Urgl',
  'Toxtricity': 'Riffex',
  'Centiskorch': 'Infernopod',
  'Dragapult': 'Katapuldra',
  'Zacian': 'Zacian',
  'Zamazenta': 'Zamazenta',
  'Eternatus': 'Endynalos',
  'Urshifu': 'Wulaosu',
  'Zarude': 'Zarude',
  'Regieleki': 'Regieleki',
  'Regidrago': 'Regidrago',
  'Calyrex': 'Coronospa',

  // Gen 9
  'Sprigatito': 'Felori',
  'Floragato': 'Feliospa',
  'Meowscarada': 'Maskagato',
  'Fuecoco': 'Krokel',
  'Crocalor': 'Lokroko',
  'Skeledirge': 'Skelokrok',
  'Quaxly': 'Kwaks',
  'Quaxwell': 'Fuentente',
  'Quaquaval': 'Bailonda',
  'Pawmi': 'Pamo',
  'Pawmo': 'Pamamo',
  'Pawmot': 'Pamomamo',
  'Armarouge': 'Crimanzo',
  'Ceruledge': 'Knarbon',
  'Bellibolt': 'Wampitz',
  'Tinkaton': 'Granforgita',
  'Palafin': 'Delfinator',
  'Gholdengo': 'Monetigo',
  'Roaring Moon': 'Furienblitz',
  'Iron Valiant': 'Eisenkrieger',
  'Koraidon': 'Koraidon',
  'Miraidon': 'Miraidon',
  'Ogerpon': 'Ogerpon',
  'Terapagos': 'Terapagos',
  'Pecharunt': 'Infamomo',
};

// Comprehensive German Set Name Mappings across TCGs
export const SET_TRANSLATIONS = {
  // Pokémon Scarlet & Violet (DE / EN / Set codes)
  'sv8a': 'Prismatische Entwicklungen (Terastal Festival)',
  'pre': 'Prismatische Entwicklungen',
  'prismatic evolutions': 'Prismatische Entwicklungen',
  'terastal festival': 'Prismatische Entwicklungen (Terastal Festival)',
  'sv8': 'Stürmische Funken',
  'ssp': 'Stürmische Funken',
  'surging sparks': 'Stürmische Funken',
  'supercharged breaker': 'Stürmische Funken (Supercharged Breaker)',
  'sv7a': 'Paradise Dragona (JP)',
  'paradise dragona': 'Paradise Dragona (JP)',
  'sv7': 'Stellarkrone',
  'scr': 'Stellarkrone',
  'stellar crown': 'Stellarkrone',
  'stellar miracle': 'Stellarkrone (Stellar Miracle)',
  'sv6a': 'Night Wanderer (JP)',
  'night wanderer': 'Night Wanderer (JP)',
  'sv6': 'Maskeraden im Zwielicht',
  'twm': 'Maskeraden im Zwielicht',
  'twilight masquerade': 'Maskeraden im Zwielicht',
  'maskeraden-im-zwielicht': 'Maskeraden im Zwielicht',
  'transformation mask': 'Maskeraden im Zwielicht (Transformation Mask)',
  'sv5a': 'Crimson Haze (JP)',
  'crimson haze': 'Crimson Haze (JP)',
  'sv5': 'Gewalten der Zeit',
  'tef': 'Gewalten der Zeit',
  'temporal forces': 'Gewalten der Zeit',
  'gewalten-der-zeit': 'Gewalten der Zeit',
  'wild force': 'Gewalten der Zeit (Wild Force)',
  'cyber judge': 'Gewalten der Zeit (Cyber Judge)',
  'sv4a': 'Shiny Treasure ex (JP)',
  'shiny treasure ex': 'Shiny Treasure ex (JP)',
  'sv4': 'Paradoxrift',
  'par': 'Paradoxrift',
  'paradox rift': 'Paradoxrift',
  'ancient roar': 'Paradoxrift (Ancient Roar)',
  'future flash': 'Paradoxrift (Future Flash)',
  'sv3a': 'Raging Surf (JP)',
  'raging surf': 'Raging Surf (JP)',
  'sv3': 'Obsidianflammen',
  'obf': 'Obsidianflammen',
  'obsidian flames': 'Obsidianflammen',
  'obsidian-flammen': 'Obsidianflammen',
  'ruler of the black flame': 'Obsidianflammen (Ruler of Black Flame)',
  'sv2a': 'Pokémon 151',
  '151': 'Pokémon 151',
  'mew': 'Pokémon 151',
  'pokemon card 151': 'Pokémon 151',
  'sv2': 'Entwicklungen in Paldea',
  'pal': 'Entwicklungen in Paldea',
  'paldea evolved': 'Entwicklungen in Paldea',
  'entwicklungen-in-paldea': 'Entwicklungen in Paldea',
  'clay burst': 'Entwicklungen in Paldea (Clay Burst)',
  'snow hazard': 'Entwicklungen in Paldea (Snow Hazard)',
  'sv1': 'Karmesin & Purpur',
  'svi': 'Karmesin & Purpur',
  'scarlet & violet': 'Karmesin & Purpur',
  'scarlet and violet': 'Karmesin & Purpur',
  'karmesin-purpur': 'Karmesin & Purpur',
  'scarlet ex': 'Karmesin (Scarlet ex)',
  'violet ex': 'Purpur (Violet ex)',

  // Pokémon Sword & Shield
  's12a': 'Zenit der Könige (VSTAR Universe)',
  'vstar universe': 'Zenit der Könige (VSTAR Universe)',
  'crz': 'Zenit der Könige',
  'crown zenith': 'Zenit der Könige',
  'zenit-der-koenige': 'Zenit der Könige',
  's12': 'Silberne Sturmwinde (Paradigm Trigger)',
  'sit': 'Silberne Sturmwinde',
  'silver tempest': 'Silberne Sturmwinde',
  'paradigm trigger': 'Silberne Sturmwinde (Paradigm Trigger)',
  's11a': 'Incandescent Arcana (JP)',
  'incandescent arcana': 'Incandescent Arcana (JP)',
  's11': 'Verlorener Ursprung (Lost Abyss)',
  'lor': 'Verlorener Ursprung',
  'lost origin': 'Verlorener Ursprung',
  'lost abyss': 'Verlorener Ursprung (Lost Abyss)',
  's10b': 'Pokémon GO',
  'pgo': 'Pokémon GO',
  'pokemon go': 'Pokémon GO',
  's10a': 'Dark Phantasma (JP)',
  'dark phantasma': 'Dark Phantasma (JP)',
  's10': 'Astralglanz (Time Gazer & Space Juggler)',
  'asr': 'Astralglanz',
  'astral radiance': 'Astralglanz',
  'time gazer': 'Astralglanz (Time Gazer)',
  'space juggler': 'Astralglanz (Space Juggler)',
  's9a': 'Battle Region (JP)',
  'battle region': 'Battle Region (JP)',
  's9': 'Strahlende Sterne (Star Birth)',
  'brs': 'Strahlende Sterne',
  'brilliant stars': 'Strahlende Sterne',
  'star birth': 'Strahlende Sterne (Star Birth)',
  's8b': 'VMAX Climax (JP)',
  'vmax climax': 'VMAX Climax (JP)',
  's8': 'Fusionsangriff (Fusion Arts)',
  'fst': 'Fusionsangriff',
  'fusion strike': 'Fusionsangriff',
  'fusion arts': 'Fusionsangriff (Fusion Arts)',
  's7': 'Drachenwandel (Blue Sky Stream & Skyscraping Perfection)',
  'evs': 'Drachenwandel',
  'evolving skies': 'Drachenwandel',
  's6a': 'Eevee Heroes (JP)',
  'eevee heroes': 'Drachenwandel (Eevee Heroes)',
  's6': 'Schaurige Herrschaft (Silver Lance & Jet-Black Spirit)',
  'cre': 'Schaurige Herrschaft',
  'chilling reign': 'Schaurige Herrschaft',
  's5a': 'Matchless Fighters (JP)',
  'matchless fighters': 'Matchless Fighters (JP)',
  's5': 'Kampfstile (Single Strike & Rapid Strike Master)',
  'bst': 'Kampfstile',
  'battle styles': 'Kampfstile',
  'shf': 'Glänzendes Schicksal (Shiny Star V)',
  'shining fates': 'Glänzendes Schicksal',
  'shiny star v': 'Glänzendes Schicksal (Shiny Star V)',
  'vv': 'Farbenschock (Astonishing Volt Tackle)',
  'vivid voltage': 'Farbenschock',
  'astonishing volt tackle': 'Farbenschock',
  'daa': 'Flammende Finsternis (Infinity Zone)',
  'darkness ablaze': 'Flammende Finsternis',
  'infinity zone': 'Flammende Finsternis',
  'rcl': 'Clash der Rebellen (Rebellion Crash)',
  'rebel clash': 'Clash der Rebellen',
  'ssh': 'Schwert & Schild',
  'sword & shield': 'Schwert & Schild',
  'sword and shield': 'Schwert & Schild',

  // Pokémon Sun & Moon
  'cec': 'Welten im Wandel (Dream League & Alter Genesis)',
  'cosmic eclipse': 'Welten im Wandel',
  'dream league': 'Welten im Wandel (Dream League)',
  'alter genesis': 'Welten im Wandel (Alter Genesis)',
  'hif': 'Verborgenes Schicksal (Tag All Stars)',
  'hidden fates': 'Verborgenes Schicksal',
  'tag all stars': 'Verborgenes Schicksal (Tag All Stars)',
  'unm': 'Bund der Gleichgesinnten (Miracle Twin)',
  'unified minds': 'Bund der Gleichgesinnten',
  'unb': 'Kräfte im Einklang (Double Blaze)',
  'unbroken bonds': 'Kräfte im Einklang',
  'teu': 'Teams sind Trumpf (Tag Bolt)',
  'team up': 'Teams sind Trumpf',
  'lot': 'Echo des Donners (Super-Burst Impact)',
  'lost thunder': 'Echo des Donners',
  'drm': 'Majestät der Drachen (Dragon Storm)',
  'dragon majesty': 'Majestät der Drachen',
  'ces': 'Sturm am Firmament (Celestial Storm)',
  'celestial storm': 'Sturm am Firmament',
  'fli': 'Grauen der Lichtfinsternis (Forbidden Light)',
  'forbidden light': 'Grauen der Lichtfinsternis',
  'upr': 'Ultra-Prisma (Ultra Sun & Ultra Moon)',
  'ultra prism': 'Ultra-Prisma',
  'cri': 'Aufziehen der Sturmröte (Crimson Invasion)',
  'crimson invasion': 'Aufziehen der Sturmröte',
  'slg': 'Schimmernde Legenden (Shining Legends)',
  'shining legends': 'Schimmernde Legenden',
  'bus': 'Nacht in Flammen (Burning Shadows)',
  'burning shadows': 'Nacht in Flammen',
  'gri': 'Stunde der Wächter (Guardians Rising)',
  'guardians rising': 'Stunde der Wächter',
  'sum': 'Sonne & Mond (Sun & Moon)',
  'sun & moon': 'Sonne & Mond',
  'sun and moon': 'Sonne & Mond',
  'evo': 'Evolution (Evolutions)',
  'evolutions': 'Evolution',

  // Chinese Sets (Gem Pack, Crossing Shadows, Brave Stars, Nine Colors)
  'cbb1c': 'Gem Pack Vol. 1 (CBB1C)',
  'cbb2c': 'Gem Pack Vol. 2 (CBB2C)',
  'cbb3c': 'Gem Pack Vol. 3 (CBB3C)',
  'cbb4c': 'Gem Pack Vol. 4 (CBB4C)',
  'cbb5c': 'Gem Pack Vol. 5 (CBB5C)',
  'cbb6c': 'Gem Pack Vol. 6 (CBB6C)',
  'gem pack vol 1': 'Gem Pack Vol. 1',
  'gem pack vol 2': 'Gem Pack Vol. 2',
  'gem pack vol 3': 'Gem Pack Vol. 3',
  'gem pack vol 4': 'Gem Pack Vol. 4',
  'gem pack vol 5': 'Gem Pack Vol. 5',
  'gem pack vol 6': 'Gem Pack Vol. 6',
  'gem-pack-vol-1': 'Gem Pack Vol. 1',
  'gem-pack-vol-2': 'Gem Pack Vol. 2',
  'gem-pack-vol-3': 'Gem Pack Vol. 3',
  'gem-pack-vol-4': 'Gem Pack Vol. 4',
  'gem-pack-vol-5': 'Gem Pack Vol. 5',
  'gem-pack-vol5': 'Gem Pack Vol. 5',
  'gem-pack-vol-6': 'Gem Pack Vol. 6',
  'cs1a': 'Crossing Shadows: Origin (CS1a)',
  'cs1b': 'Crossing Shadows: Spark (CS1b)',
  'cs2a': 'Brave Stars: Flash (CS2a)',
  'cs2b': 'Brave Stars: Spark (CS2b)',
  'cs3a': 'Radiant Strike (CS3a)',
  'cs3b': 'Radiant Guard (CS3b)',
  'cs4a': 'Shadow of the Glory (CS4a)',
  'cs4b': 'Shadow of the Glory (CS4b)',
  'cs5a': 'Nine Colors Gathering: Origin (CS5a)',
  'cs5b': 'Nine Colors Gathering: Spark (CS5b)',

  // One Piece Sets
  'op01': 'Romance Dawn (OP-01)',
  'op-01': 'Romance Dawn (OP-01)',
  'op02': 'Paramount War (OP-02)',
  'op-02': 'Paramount War (OP-02)',
  'op03': 'Pillars of Strength (OP-03)',
  'op-03': 'Pillars of Strength (OP-03)',
  'op04': 'Kingdoms of Intrigue (OP-04)',
  'op-04': 'Kingdoms of Intrigue (OP-04)',
  'op05': 'Awakening of the New Era (OP-05)',
  'op-05': 'Awakening of the New Era (OP-05)',
  'op06': 'Flamboyant Wings (OP-06)',
  'op-06': 'Flamboyant Wings (OP-06)',
  'op07': '500 Years in the Future (OP-07)',
  'op-07': '500 Years in the Future (OP-07)',
  'op08': 'Two Legends (OP-08)',
  'op-08': 'Two Legends (OP-08)',
  'op09': 'Emperors in the New World (OP-09)',
  'op-09': 'Emperors in the New World (OP-09)',
  'op10': 'The Royal Bloodline (OP-10)',
  'op-10': 'The Royal Bloodline (OP-10)',
  'eb01': 'Memorial Collection (EB-01)',
  'eb-01': 'Memorial Collection (EB-01)',
  'eb02': 'Anime 25th Collection (EB-02)',
  'eb-02': 'Anime 25th Collection (EB-02)',
  'prb01': 'Premium Booster The Best (PRB-01)',
  'prb-01': 'Premium Booster The Best (PRB-01)',
  'st01': 'Starter Deck Straw Hat Crew (ST-01)',
  'st02': 'Starter Deck Worst Generation (ST-02)',
  'st03': 'Starter Deck The Seven Warlords (ST-03)',
  'st04': 'Starter Deck Animal Kingdom Pirates (ST-04)',
  'st05': 'Starter Deck ONE PIECE FILM (ST-05)',
  'st10': 'Ultimate Deck The Three Captains (ST-10)',
  'st13': 'Ultimate Deck The Three Brothers (ST-13)',
  'st18': 'Starter Deck Purple Luffy (ST-18)',

  // Lorcana Sets (DE)
  'lorcana 1': 'Das Erste Kapitel',
  'das erste kapitel': 'Das Erste Kapitel',
  'the first chapter': 'Das Erste Kapitel',
  'lorcana 2': 'Aufstieg der Flutgestalten',
  'rise of the floodborn': 'Aufstieg der Flutgestalten',
  'aufstieg der flutgestalten': 'Aufstieg der Flutgestalten',
  'lorcana 3': 'Die Tintenlande',
  'into the inklands': 'Die Tintenlande',
  'die tintenlande': 'Die Tintenlande',
  'lorcana 4': 'Ursulas Rückkehr',
  'ursulas return': 'Ursulas Rückkehr',
  'ursulas rueckkehr': 'Ursulas Rückkehr',
  'lorcana 5': 'Himmelsleuchten',
  'shimmering skies': 'Himmelsleuchten',
  'himmelsleuchten': 'Himmelsleuchten',
  'lorcana 6': 'Azurblaues Meer',
  'azurite sea': 'Azurblaues Meer',
  'azurblaues meer': 'Azurblaues Meer',
};

/**
 * Translates a card name to German if known, preserving suffixes (e.g. ex, VMAX, GX, VSTAR)
 */
export function translateCardName(rawName, tcg = 'Pokemon') {
  if (!rawName || typeof rawName !== 'string') return '';
  const clean = rawName.trim();
  if (!clean || clean.toLowerCase() === 'karte') return 'Karte';

  if (tcg !== 'Pokemon') {
    return clean;
  }

  // Check if direct match exists in dictionary
  if (POKEMON_NAME_EN_TO_DE[clean]) {
    return POKEMON_NAME_EN_TO_DE[clean];
  }

  // Extract base name and suffix e.g. "Charizard ex" -> base: "Charizard", suffix: "ex"
  const suffixMatch = clean.match(/^([A-Za-z0-9'\.\s-]+?)\s+(ex|EX|GX|VMAX|VSTAR|V-UNION|V|LV\.\d+|Prime|Star|BREAK|Prism Star|Radiant|Tera)$/i);
  if (suffixMatch && suffixMatch[1]) {
    const base = suffixMatch[1].trim();
    const suffix = suffixMatch[2].trim();
    const deBase = POKEMON_NAME_EN_TO_DE[base] || base;
    return `${deBase} ${suffix}`.trim();
  }

  return clean;
}

/**
 * Translates a set name or set code into a clean German set name
 */
export function translateSetName(setStr, code = '', tcg = 'Pokemon') {
  const s = (setStr || '').trim();
  const c = (code || '').trim();

  // Try direct lookup of set string
  const sKey = s.toLowerCase().replace(/[-_]/g, ' ').trim();
  if (SET_TRANSLATIONS[sKey]) return SET_TRANSLATIONS[sKey];

  // Try code pattern matching (e.g. CBB4C, CS1a, sv2a, s12a, OP05, TWM, MEW, PAF)
  if (c) {
    const codeClean = c.toLowerCase().replace(/[\/-]/g, '');

    // Look for any alphanumeric set code pattern in the string (e.g. CBB4C, sv2a, CS1a, OP05, S12a)
    const codeMatch = c.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|S-P|SVP|SWSH|MEW|CRZ|SSP|CEC|SCR|BS|MEP|DP|PFL|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2})\b/i);
    if (codeMatch) {
      const matchKey = codeMatch[1].toLowerCase();
      if (SET_TRANSLATIONS[matchKey]) return SET_TRANSLATIONS[matchKey];
    }

    const prefixMatch = c.match(/^([A-Za-z]{1,5}\d{1,2}[A-Za-z]?|[A-Za-z]{2,6}\d{0,2})/i);
    const prefix = prefixMatch ? prefixMatch[1].toLowerCase() : '';

    if (SET_TRANSLATIONS[c.toLowerCase()]) return SET_TRANSLATIONS[c.toLowerCase()];
    if (prefix && SET_TRANSLATIONS[prefix]) return SET_TRANSLATIONS[prefix];
    if (SET_TRANSLATIONS[codeClean]) return SET_TRANSLATIONS[codeClean];
  }

  // Also check if setStr itself has a known set code (e.g. "cBB4C")
  if (s) {
    const setCodeMatch = s.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE)\b/i);
    if (setCodeMatch) {
      const matchKey = setCodeMatch[1].toLowerCase();
      if (SET_TRANSLATIONS[matchKey]) return SET_TRANSLATIONS[matchKey];
    }
  }

  return s || (tcg === 'OnePiece' ? 'One Piece Card Game' : (tcg === 'Pokemon' ? 'Pokémon TCG' : 'Sammelkartenspiel'));
}

/**
 * Universal Card Metadata Formatter
 * Extracts clean localized name, set name, card code, and variant tag from any card representation
 */
export function formatCardMeta(cardId, rawName = '', rawSet = '', code = '', tcg = 'Pokemon') {
  let cleanId = decodeURIComponent(cardId || '').trim();
  let extractedSetSlug = '';
  let extractedCardSlug = cleanId;

  // 1. If cardId is a Cardmarket URL path (e.g. /Pokemon/Products/Singles/Gem-Pack-Vol-4/Phione-V1-CBB4C13)
  if (cleanId.includes('/')) {
    const segments = cleanId.split('/').filter(Boolean);
    if (segments.length >= 2) {
      extractedCardSlug = segments[segments.length - 1];
      const prev = segments[segments.length - 2];
      if (prev && prev.toLowerCase() !== 'singles' && prev.toLowerCase() !== 'products') {
        extractedSetSlug = prev.replace(/[-_]/g, ' ').trim();
      }
    } else if (segments.length === 1) {
      extractedCardSlug = segments[0];
    }
  }

  // 2. Parse variants e.g. "V1", "V2", "V9"
  const combined = `${code || ''} ${extractedCardSlug || ''} ${rawName || ''} ${rawSet || ''}`.trim();
  let variantTag = null;

  const compMatch = combined.match(/\b(\d{2})(\d{2})\/(\d{2})\b/);
  if (compMatch) {
    variantTag = `V${parseInt(compMatch[2], 10)}`;
  } else {
    const vMatch = combined.match(/\b(V\d+)\b/i) || combined.match(/\((V\d+)\)/i);
    if (vMatch) {
      variantTag = vMatch[1].toUpperCase();
    }
  }

  const verNum = variantTag ? variantTag.replace(/\D/g, '') : '';
  const variantLabel = verNum ? `Version ${verNum}` : (variantTag ? `Version ${variantTag}` : '');

  // 3. Extract clean base card name
  let nameClean = rawName || '';
  if (!nameClean || nameClean.toLowerCase() === 'karte') {
    let baseSlug = extractedCardSlug.replace(/^tcgdex_/i, '').replace(/\([^)]*\)/g, '').trim();
    if (variantTag) {
      baseSlug = baseSlug.replace(new RegExp(`[-_]?${variantTag}[-_]?[A-Za-z0-9]*`, 'i'), '').trim();
    }
    baseSlug = baseSlug.replace(/[-_][A-Za-z0-9]{2,6}[-_]\d{1,4}[A-Za-z]?$/i, '')
                       .replace(/[-_][A-Za-z]{2,5}\d{1,4}[A-Za-z]?$/i, '')
                       .replace(/[-_](?!ex$|gx$|v$|vmax$|vstar$|tera$|prime$|star$|break$)[A-Za-z]{2,6}\d{0,4}$/i, '')
                       .replace(/[-_]\d{1,4}[-_]\d{1,4}$/, '')
                       .replace(/[-_]\d{1,4}$/, '');
    nameClean = baseSlug.replace(/[-_]/g, ' ')
                        .replace(/MonkeyDLuffy/i, 'Monkey.D.Luffy')
                        .replace(/TrafalgarLaw/i, 'Trafalgar Law')
                        .replace(/RoronoaZoro/i, 'Roronoa Zoro')
                        .replace(/PortgasDAce/i, 'Portgas.D.Ace')
                        .replace(/TonyTonyChopper/i, 'Tony Tony Chopper')
                        .trim();
  }

  const nameDe = translateCardName(nameClean, tcg) || nameClean || 'Karte';
  const nameEn = nameClean || nameDe;

  // 4. Extract clean set name
  const rawSetEff = rawSet || extractedSetSlug || '';
  const setNameDe = translateSetName(rawSetEff, code, tcg);

  // 5. Extract clean card code
  let cleanCode = (code || '').trim();
  if (!cleanCode) {
    const fractionMatch = extractedCardSlug.match(/[-_](\d{1,4})[-_](\d{2,4})$/);
    if (fractionMatch) {
      cleanCode = `${fractionMatch[1]}/${fractionMatch[2]}`;
    } else {
      const codeMatch = extractedCardSlug.match(/\b(CBB\d{1,2}[A-Za-z]?\d{1,2}|CS\d{1,2}[a-zA-Z]?\d{1,3}|[A-Za-z]{2,5}\d{1,4}|[A-Za-z0-9]+-\d+)\b/);
      if (codeMatch) cleanCode = codeMatch[1];
    }
  }

  return {
    nameDe,
    nameEn,
    setNameDe,
    cardCode: cleanCode,
    variant: variantTag,
    variantLabel,
    fullTitle: `${nameDe}${setNameDe ? ` (${setNameDe})` : ''}${variantTag ? ` • ${variantTag}` : ''}`,
  };
}

/**
 * Returns clean readable card name from cardId
 */
export function cleanCardName(cardId, tcg = 'Pokemon') {
  if (!cardId) return '';
  const meta = formatCardMeta(cardId, '', '', '', tcg);
  if (meta.setNameDe && meta.setNameDe !== 'Pokémon TCG' && meta.setNameDe !== 'TCG Set') {
    return `${meta.nameDe}${meta.variant ? ` (${meta.variant})` : ''} (${meta.setNameDe})`;
  }
  return meta.nameDe || cardId;
}

/**
 * Returns comprehensive localized details for a card item
 */
export function getGermanCardDetails(item) {
  if (!item) return { nameDe: 'Karte', setNameDe: 'TCG', nameEn: 'Karte', code: '' };

  const rawName = item.detectedName || item.rawName || 'Karte';
  const tcg = item.tcg || 'Pokemon';
  const code = item.detectedCode || item.rawCode || '';
  const rawSet = item.rawSet || item.set || item.cardDetails?.set_name || '';

  const meta = formatCardMeta(item.cardDetails?.cardmarket_url || item.card_id, rawName, rawSet, code, tcg);

  return {
    nameDe: meta.nameDe,
    setNameDe: meta.setNameDe,
    nameEn: meta.nameEn,
    code: meta.cardCode || code,
    variant: meta.variant || item.variant || null,
    isTranslated: meta.nameDe !== rawName,
  };
}
