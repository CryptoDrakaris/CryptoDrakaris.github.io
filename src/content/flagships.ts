// Copy and canon for flagship collection pages. Facts are paraphrased from official sources.
import type { Lang, Plural } from '../i18n/ui';
import type { ThemeKey } from '../lib/themes';

export type FlagshipCopy = {
  /** hero line 1, gets the owned count: "{n} lions." */
  heroCount: Plural;
  /** hero line 2, accent color */
  heroLine: string;
  lead: string;
  whyTitle: string;
  why: { title: string; text: string }[];
  about: string;
};

export type Flagship = {
  theme: ThemeKey;
  links: { website?: string; x?: string; discord?: string; instagram?: string; youtube?: string };
  supply?: number;
  launched?: string;
  creator?: string;
  copy: Record<Lang, FlagshipCopy>;
};

export const FLAGSHIP_INFO: Record<string, Flagship> = {
  'lazy-lions': {
    theme: 'lazy-lions',
    links: {
      website: 'https://lazylionsnft.com/',
      x: 'https://x.com/LazyLionsNFT',
      discord: 'https://discord.gg/lazy-lions-869565356400844820',
      instagram: 'https://instagram.com/lazylionsnft',
      youtube: 'https://youtube.com/@lazylionsnft',
    },
    supply: 10080,
    launched: '2021',
    copy: {
      en: {
        heroCount: { one: '{n} lion.', other: '{n} lions.' },
        heroLine: 'One pride.',
        lead: 'Lazy Lions were my first love in NFTs. Lions, cubs, scenes, bungalows and comics – the whole universe lives here.',
        whyTitle: 'More than a JPEG in a wallet.',
        why: [
          { title: 'Identity', text: 'Your Lion is your face across the whole ecosystem. You can give it a name and lore that live on-chain.' },
          { title: 'Tools for holders', text: 'LazyStudio turns your Lion into comics, coloring pages and GIFs. LazyEdge opens a prediction-market terminal.' },
          { title: 'A growing universe', text: 'Cubs, Bungalows, Generals, comics and games. Ownership plugs into all of it.' },
        ],
        about: 'Lazy Lions is a collection of 10,080 lions on Ethereum. The idea: ownership is the start, not the end. A Lion unlocks tools, content and ways to take part in the ecosystem.',
      },
      ru: {
        heroCount: { one: '{n} лев.', few: '{n} льва.', many: '{n} львов.', other: '{n} льва.' },
        heroLine: 'Один прайд.',
        lead: 'Lazy Lions – моя первая любовь в NFT. Львы, львята, сцены, бунгало и комиксы – здесь живёт вся вселенная.',
        whyTitle: 'Больше, чем картинка в кошельке.',
        why: [
          { title: 'Личность', text: 'Твой лев – твоё лицо во всей экосистеме. Ему можно дать имя и историю, которые хранятся on-chain.' },
          { title: 'Инструменты для холдеров', text: 'LazyStudio превращает льва в комиксы, раскраски и гифки. LazyEdge открывает терминал аналитики рынков предсказаний.' },
          { title: 'Вселенная растёт', text: 'Cubs, Bungalows, Generals, комиксы и игры. Владение львом подключает ко всему этому.' },
        ],
        about: 'Lazy Lions – коллекция из 10 080 львов на Ethereum. Идея в том, что покупка – только начало. Лев открывает инструменты, контент и участие в экосистеме.',
      },
      kk: {
        heroCount: { other: '{n} арыстан.' },
        heroLine: 'Бір прайд.',
        lead: 'Lazy Lions – NFT әлеміндегі алғашқы махаббатым. Арыстандар, күшіктер, сахналар, бунгалолар және комикстер – бүкіл әлем осында.',
        whyTitle: 'Әмияндағы суреттен әлдеқайда көп.',
        why: [
          { title: 'Тұлға', text: 'Арыстаның – бүкіл экожүйедегі сенің бейнең. Оған on-chain сақталатын есім мен тарих беруге болады.' },
          { title: 'Холдерлерге арналған құралдар', text: 'LazyStudio арыстаныңнан комикс, бояу суреттері мен GIF жасайды. LazyEdge болжам нарықтарының терминалын ашады.' },
          { title: 'Әлем кеңейіп жатыр', text: 'Cubs, Bungalows, Generals, комикстер мен ойындар. Арыстан иесі осының бәріне қосылады.' },
        ],
        about: 'Lazy Lions – Ethereum желісіндегі 10 080 арыстаннан тұратын коллекция. Негізгі ой: сатып алу – тек бастама. Арыстан құралдарға, контентке және экожүйеге қатысуға жол ашады.',
      },
    },
  },
};

// Sources (checked 2026-09-15): docs.grayboysnft.com; archived bubblegumkidsnft.com; robotos.art, robotos.art/robopets,
// time.com/6123080; nonconformistducks.com + whitepaper v1.1; archived adambombsquad.com, decrypt.co/114045; Blockscout.
Object.assign(FLAGSHIP_INFO, {
  'gray-boys': {
    theme: 'gray-boys',
    links: {
      website: 'https://docs.grayboysnft.com/',
      x: 'https://twitter.com/grayboysdao',
      discord: 'https://discord.gg/grayboys',
      instagram: 'https://instagram.com/grayboysnft',
    },
    supply: 10000,
    launched: '2021',
    creator: 'NFT Worlds founders',
    copy: {
      en: {
        heroCount: { one: '{n} Gray Boy.', other: '{n} Gray Boys.' },
        heroLine: 'Welcome aboard.',
        lead: 'Big black eyes, a Mothership and a lab full of mutations. My little alien crew lives here.',
        whyTitle: 'An alien DAO with a sense of humor.',
        why: [
          { title: 'The Mothership DAO', text: 'Holding a Gray Boy makes you a member of a DAO that buys NFTs, and members share ownership of what it collects.' },
          { title: 'Science Lab', text: 'A sibling collection of mutations and experiments grew out of the main drop.' },
          { title: 'Factions and $GRAY', text: 'Holders split into factions, and the project runs its own $GRAY token.' },
        ],
        about: 'Gray Boys is a collection of 10,000 aliens with 600+ traits, launched on Ethereum in November 2021 by the founders of NFT Worlds.',
      },
      ru: {
        heroCount: { other: '{n} Gray Boys.' },
        heroLine: 'Добро пожаловать на борт.',
        lead: 'Большие чёрные глаза, корабль-матка и лаборатория мутаций. Здесь живёт мой маленький инопланетный экипаж.',
        whyTitle: 'Инопланетный DAO с чувством юмора.',
        why: [
          { title: 'The Mothership DAO', text: 'Владелец Gray Boy становится участником DAO, который покупает NFT, а участники вместе владеют собранным.' },
          { title: 'Science Lab', text: 'Из основного дропа выросла коллекция-спутник с мутациями и экспериментами.' },
          { title: 'Фракции и $GRAY', text: 'Холдеры делятся на фракции, у проекта есть собственный токен $GRAY.' },
        ],
        about: 'Gray Boys – коллекция из 10 000 инопланетян и 600+ признаков. Запущена на Ethereum в ноябре 2021 года основателями NFT Worlds.',
      },
      kk: {
        heroCount: { other: '{n} Gray Boys.' },
        heroLine: 'Бортқа қош келдің.',
        lead: 'Үлкен қара көздер, ана кеме және мутациялар зертханасы. Менің кішкентай бөгде ғаламшарлық экипажым осында.',
        whyTitle: 'Әзіл сезімі бар бөгде ғаламшарлық DAO.',
        why: [
          { title: 'The Mothership DAO', text: 'Gray Boy иесі NFT сатып алатын DAO мүшесі болады, ал жиналған NFT-ге мүшелер бірге иелік етеді.' },
          { title: 'Science Lab', text: 'Негізгі дроптан мутациялар мен эксперименттерге арналған серік коллекция пайда болды.' },
          { title: 'Фракциялар және $GRAY', text: 'Холдерлер фракцияларға бөлінеді, жобаның өз $GRAY токені бар.' },
        ],
        about: 'Gray Boys – 10 000 бөгде ғаламшарлықтан және 600-ден астам белгіден тұратын коллекция. 2021 жылдың қарашасында NFT Worlds негізін қалаушылар Ethereum желісінде іске қосқан.',
      },
    },
  },
  'bubblegum-kids': {
    theme: 'bubblegum-kids',
    links: {
      x: 'https://twitter.com/bubblegumkids_',
      discord: 'https://discord.com/invite/RVeHpEqsgT',
      instagram: 'https://instagram.com/bubblegumkids.nft',
    },
    supply: 10000,
    launched: '2021',
    copy: {
      en: {
        heroCount: { other: 'Bubblegum' },
        heroLine: 'Kids & Puppies!',
        lead: 'Candy colors, comic vibes and a puppy for every kid. The sweetest corner of my wallet.',
        whyTitle: 'Blow a bubble, join the gang.',
        why: [
          { title: 'Two collections', text: 'Kids came first, then holders minted Bubblegum Puppies for free: 20,000 NFTs in the family.' },
          { title: 'Bubblegum Land', text: 'The project has its own plot in The Sandbox with voxel versions of the characters.' },
          { title: 'Holder perks', text: 'Merch drops, DAO membership and free mints were part of the plan from day one.' },
        ],
        about: 'Bubblegum Kids is a collection of 10,000 kids on Ethereum, launched in September 2021, with the Bubblegum Puppies collection as its sidekick.',
      },
      ru: {
        heroCount: { other: 'Bubblegum' },
        heroLine: 'Kids & Puppies!',
        lead: 'Конфетные цвета, комиксное настроение и щенок для каждого кида. Самый сладкий угол моего кошелька.',
        whyTitle: 'Надуй пузырь и заходи в банду.',
        why: [
          { title: 'Две коллекции', text: 'Сначала вышли Kids, потом холдеры бесплатно сминтили Bubblegum Puppies: всего в семье 20 000 NFT.' },
          { title: 'Bubblegum Land', text: 'У проекта свой участок в The Sandbox с воксельными версиями персонажей.' },
          { title: 'Бонусы холдерам', text: 'Мерч, участие в DAO и бесплатные минты были в планах с первого дня.' },
        ],
        about: 'Bubblegum Kids – коллекция из 10 000 детей на Ethereum, запущена в сентябре 2021 года. Компанию ей составляет коллекция Bubblegum Puppies.',
      },
      kk: {
        heroCount: { other: 'Bubblegum' },
        heroLine: 'Kids & Puppies!',
        lead: 'Кәмпит түстері, комикс көңіл-күйі және әр балаға бір күшік. Әмиянымның ең тәтті бұрышы.',
        whyTitle: 'Көпіршік үрле де, топқа қосыл.',
        why: [
          { title: 'Екі коллекция', text: 'Алдымен Kids шықты, кейін холдерлер Bubblegum Puppies-ті тегін минттеді: отбасында барлығы 20 000 NFT.' },
          { title: 'Bubblegum Land', text: 'Жобаның The Sandbox-та кейіпкерлердің воксель нұсқалары бар өз учаскесі бар.' },
          { title: 'Холдерлерге бонустар', text: 'Мерч, DAO мүшелігі және тегін минттер алғашқы күннен жоспарда болды.' },
        ],
        about: 'Bubblegum Kids – Ethereum желісіндегі 10 000 баладан тұратын коллекция, 2021 жылдың қыркүйегінде іске қосылған. Оның серігі – Bubblegum Puppies коллекциясы.',
      },
    },
  },
  robotos: {
    theme: 'robotos',
    links: {
      website: 'https://www.robotos.art/',
      x: 'https://twitter.com/robotosnft',
      instagram: 'https://www.instagram.com/robotosnfts/',
    },
    supply: 9999,
    launched: '2021',
    creator: 'Pablo Stanley',
    copy: {
      en: {
        heroCount: { one: '{n} bot.', other: '{n} bots.' },
        heroLine: 'Beep boop, gm.',
        lead: 'Friendly droids by Pablo Stanley, their robopets and one very special TIME cover.',
        whyTitle: 'Tin faces, big hearts.',
        why: [
          { title: 'Made by Pablo Stanley', text: 'Hand-drawn droids with 170+ traits, and holders get rights to make derivatives of their bots.' },
          { title: 'Robopets', text: 'In October 2021 every Roboto holder could mint a free robopet companion.' },
          { title: 'TIME Studios', text: 'TIME announced an animated children’s series based on Robotos and released a Roboto of the Year cover.' },
        ],
        about: 'Robotos is a collection of 9,999 droids on Ethereum, launched in August 2021 and drawn by designer Pablo Stanley.',
      },
      ru: {
        heroCount: { one: '{n} робот.', few: '{n} робота.', many: '{n} роботов.', other: '{n} робота.' },
        heroLine: 'Бип-буп, gm.',
        lead: 'Дружелюбные дроиды Пабло Стэнли, их робопитомцы и одна особенная обложка TIME.',
        whyTitle: 'Жестяные лица, большие сердца.',
        why: [
          { title: 'Автор – Пабло Стэнли', text: 'Нарисованные вручную дроиды с 170+ признаками, а холдеры получают право делать производные работы со своими ботами.' },
          { title: 'Robopets', text: 'В октябре 2021 года каждый холдер Roboto мог бесплатно сминтить робопитомца.' },
          { title: 'TIME Studios', text: 'TIME анонсировал детский мультсериал по Robotos и выпустил обложку «Roboto года».' },
        ],
        about: 'Robotos – коллекция из 9 999 дроидов на Ethereum, запущена в августе 2021 года. Автор рисунков – дизайнер Пабло Стэнли.',
      },
      kk: {
        heroCount: { other: '{n} робот.' },
        heroLine: 'Бип-буп, gm.',
        lead: 'Пабло Стэнлидің мейірімді дроидтары, олардың робо-үй жануарлары және бір ерекше TIME мұқабасы.',
        whyTitle: 'Қаңылтыр бет, үлкен жүрек.',
        why: [
          { title: 'Авторы – Пабло Стэнли', text: 'Қолмен салынған, 170-тен астам белгісі бар дроидтар. Холдерлер өз боттарынан туынды туындылар жасауға құқық алады.' },
          { title: 'Robopets', text: '2021 жылдың қазанында әр Roboto холдері робо-жануарды тегін минттей алды.' },
          { title: 'TIME Studios', text: 'TIME Robotos негізінде балаларға арналған мультсериал жариялап, «Жыл роботы» мұқабасын шығарды.' },
        ],
        about: 'Robotos – Ethereum желісіндегі 9 999 дроидтан тұратын коллекция, 2021 жылдың тамызында іске қосылған. Суреттердің авторы – дизайнер Пабло Стэнли.',
      },
    },
  },
  'nonconformist-ducks': {
    theme: 'nonconformist-ducks',
    links: {
      website: 'https://www.nonconformistducks.com/',
      x: 'https://x.com/NoncoDucks',
      discord: 'https://discord.gg/DMnmqfGeF',
    },
    supply: 10000,
    launched: '2021',
    creator: '@Diduck',
    copy: {
      en: {
        heroCount: { one: '{n} duck.', other: '{n} ducks.' },
        heroLine: 'Four in, one out.',
        lead: 'Hand-drawn ducks that refuse to fit in, plus a few of their fiery Hell Duck cousins.',
        whyTitle: 'Ducks that play with fire.',
        why: [
          { title: 'Ducks vs Hell Ducks', text: 'The lore splits the flock in two, and the Hell Ducks have their own collection on-chain.' },
          { title: 'The burn', text: 'In 2026 the project started burning its four collections, 22,953 ducks, down to 2,222 Ducks 2.0.' },
          { title: 'Experiments', text: 'The team counts early burn mechanics and mutable metadata among its firsts.' },
        ],
        about: 'Nonconformist Ducks launched on Ethereum in 2021 with 10,000 ducks drawn by @Diduck, then grew to four collections.',
      },
      ru: {
        heroCount: { one: '{n} утка.', few: '{n} утки.', many: '{n} уток.', other: '{n} утки.' },
        heroLine: 'Четыре входят, одна выходит.',
        lead: 'Нарисованные вручную утки, которые не хотят быть как все, и пара их огненных родственников из Hell Ducks.',
        whyTitle: 'Утки, которые играют с огнём.',
        why: [
          { title: 'Ducks против Hell Ducks', text: 'По лору стая делится надвое, а у Hell Ducks своя коллекция в блокчейне.' },
          { title: 'Сжигание', text: 'В 2026 году проект начал сжигать четыре коллекции, 22 953 утки, чтобы оставить 2 222 Ducks 2.0.' },
          { title: 'Эксперименты', text: 'Команда называет одними из своих первых шагов механики сжигания и изменяемые метаданные.' },
        ],
        about: 'Nonconformist Ducks запустились на Ethereum в 2021 году с 10 000 уток, нарисованных @Diduck, а затем выросли до четырёх коллекций.',
      },
      kk: {
        heroCount: { other: '{n} үйрек.' },
        heroLine: 'Төртеуі кіреді, біреуі шығады.',
        lead: 'Басқаларға ұқсағысы келмейтін қолмен салынған үйректер және олардың Hell Ducks-тағы отты туыстары.',
        whyTitle: 'Отпен ойнайтын үйректер.',
        why: [
          { title: 'Ducks және Hell Ducks', text: 'Аңыз бойынша топ екіге бөлінеді, ал Hell Ducks-тың блокчейнде өз коллекциясы бар.' },
          { title: 'Өртеу', text: '2026 жылы жоба 22 953 үйректен тұратын төрт коллекцияны 2 222 Ducks 2.0-ге дейін өртей бастады.' },
          { title: 'Эксперименттер', text: 'Команда өртеу механикасы мен өзгермелі метадеректерді өз жаңалықтарының қатарына қосады.' },
        ],
        about: 'Nonconformist Ducks 2021 жылы Ethereum желісінде @Diduck салған 10 000 үйрекпен іске қосылып, кейін төрт коллекцияға дейін өсті.',
      },
    },
  },
  'adam-bomb-squad': {
    theme: 'adam-bomb-squad',
    links: {
      x: 'https://twitter.com/AdamBombSquad',
      discord: 'https://discord.com/invite/thehundreds',
      instagram: 'https://www.instagram.com/adambombsquad/',
    },
    supply: 25000,
    launched: '2021',
    creator: 'The Hundreds',
    copy: {
      en: {
        heroCount: { one: '{n} bomb.', other: '{n} bombs.' },
        heroLine: 'Squad up.',
        lead: 'The Hundreds mascot, lit and ready. Adam Bombs and their Badam twins from my wallet.',
        whyTitle: 'Streetwear with a lit fuse.',
        why: [
          { title: 'The Hundreds', text: 'The collection comes from the LA streetwear brand co-founded by Bobby Hundreds.' },
          { title: 'Mascot on-chain', text: '25,000 variations of Adam Bomb, the brand’s bomb character, in its red, black, white and yellow.' },
          { title: 'Badam Bomb Squad', text: 'In November 2022 the brand followed up with 5,000 Badam Bombs.' },
        ],
        about: 'Adam Bomb Squad is a collection of 25,000 Adam Bomb variations on Ethereum, released by The Hundreds in August 2021.',
      },
      ru: {
        heroCount: { one: '{n} бомба.', few: '{n} бомбы.', many: '{n} бомб.', other: '{n} бомбы.' },
        heroLine: 'Отряд в сборе.',
        lead: 'Маскот The Hundreds с зажжённым фитилём. Adam Bomb и их близнецы Badam из моего кошелька.',
        whyTitle: 'Стритвир с горящим фитилём.',
        why: [
          { title: 'The Hundreds', text: 'Коллекцию выпустил стритвир-бренд из Лос-Анджелеса, сооснователь – Бобби Хандредс.' },
          { title: 'Маскот в блокчейне', text: '25 000 вариаций Adam Bomb, персонажа-бомбы бренда, в его красно-чёрно-бело-жёлтых цветах.' },
          { title: 'Badam Bomb Squad', text: 'В ноябре 2022 года бренд выпустил продолжение – 5 000 Badam Bomb.' },
        ],
        about: 'Adam Bomb Squad – коллекция из 25 000 вариаций Adam Bomb на Ethereum, выпущена The Hundreds в августе 2021 года.',
      },
      kk: {
        heroCount: { other: '{n} бомба.' },
        heroLine: 'Отряд жиналды.',
        lead: 'Білтесі тұтанған The Hundreds маскоты. Әмиянымдағы Adam Bomb және олардың егізі Badam.',
        whyTitle: 'Білтесі жанған стритвир.',
        why: [
          { title: 'The Hundreds', text: 'Коллекцияны Лос-Анджелестегі стритвир бренді шығарды, оның негізін қалаушылардың бірі – Бобби Хандредс.' },
          { title: 'Блокчейндегі маскот', text: 'Брендтің бомба кейіпкері Adam Bomb-тың қызыл, қара, ақ және сары түстегі 25 000 нұсқасы.' },
          { title: 'Badam Bomb Squad', text: '2022 жылдың қарашасында бренд жалғасын шығарды – 5 000 Badam Bomb.' },
        ],
        about: 'Adam Bomb Squad – Ethereum желісіндегі Adam Bomb-тың 25 000 нұсқасынан тұратын коллекция, The Hundreds 2021 жылдың тамызында шығарған.',
      },
    },
  },
} satisfies Record<string, Flagship>);

// Sources (checked 2026-09-16): marscatsvoyage.com (home, /about CMS), medium.com/@marscatsvoyage, Blockscout contract.
Object.assign(FLAGSHIP_INFO, {
  'mars-cats-voyage': {
    theme: 'mars-cats-voyage',
    links: {
      website: 'https://marscatsvoyage.com/',
      x: 'https://x.com/MarsCatsVoyage',
      discord: 'https://discord.gg/mcv',
    },
    supply: 10000,
    launched: '2021',
    creator: 'Drew, Mike & Lesh',
    copy: {
      en: {
        heroCount: { one: '{n} cat.', other: '{n} cats.' },
        heroLine: 'Wen Mars?',
        lead: 'Cat astronauts on their way to Mars, plus the Alien Cats they went looking for and a spacesuit or two.',
        whyTitle: 'Flat colors, black outlines, deep space.',
        why: [
          { title: 'Your cat is yours', text: 'Holders get full commercial rights to their cat: merch, comics, whatever you build with it.' },
          { title: 'Tools and $CREAM', text: 'The site hands you a PFP maker, a banner maker and a daily reward token that costs no gas.' },
          { title: 'A growing crew', text: 'Alien Cats, Mars Cats in Spacesuits and game integrations extend the voyage.' },
        ],
        about: 'MarsCatsVoyage is a collection of 10,000 cat astronauts with 220 traits, launched on Ethereum in September 2021 by three friends. The crew is flying to Mars to build a colony and meet the Alien Cats.',
      },
      ru: {
        heroCount: { one: '{n} кот.', few: '{n} кота.', many: '{n} котов.', other: '{n} кота.' },
        heroLine: 'Wen Mars?',
        lead: 'Коты-астронавты на пути к Марсу, инопланетные коты, которых они искали, и пара скафандров.',
        whyTitle: 'Плоские цвета, чёрный контур, открытый космос.',
        why: [
          { title: 'Кот принадлежит тебе', text: 'Холдеры получают полные коммерческие права на своего кота: мерч, комиксы, что угодно.' },
          { title: 'Инструменты и $CREAM', text: 'На сайте есть генератор аватарок и баннеров, а также ежедневный токен-награда без комиссий.' },
          { title: 'Экипаж растёт', text: 'Alien Cats, коты в скафандрах и интеграции с играми продолжают путешествие.' },
        ],
        about: 'MarsCatsVoyage – коллекция из 10 000 котов-астронавтов с 220 признаками, запущена на Ethereum в сентябре 2021 года тремя друзьями. Экипаж летит на Марс, чтобы построить колонию и встретить инопланетных котов.',
      },
      kk: {
        heroCount: { other: '{n} мысық.' },
        heroLine: 'Wen Mars?',
        lead: 'Марсқа бет алған мысық-астронавттар, олар іздеген бөгде ғаламшарлық мысықтар және бірер скафандр.',
        whyTitle: 'Жалпақ түстер, қара контур, ашық ғарыш.',
        why: [
          { title: 'Мысық саған тиесілі', text: 'Холдерлер өз мысығына толық коммерциялық құқық алады: мерч, комикс, қалағаныңды жаса.' },
          { title: 'Құралдар және $CREAM', text: 'Сайтта аватар мен баннер жасайтын құралдар, сондай-ақ комиссиясыз күнделікті сыйақы токені бар.' },
          { title: 'Экипаж өсіп келеді', text: 'Alien Cats, скафандрдағы мысықтар және ойындармен интеграциялар саяхатты жалғастырады.' },
        ],
        about: 'MarsCatsVoyage – 220 белгісі бар 10 000 мысық-астронавттан тұратын коллекция, 2021 жылдың қыркүйегінде үш дос Ethereum желісінде іске қосқан. Экипаж колония салып, бөгде ғаламшарлық мысықтарды кездестіру үшін Марсқа ұшып барады.',
      },
    },
  },
} satisfies Record<string, Flagship>);

export const flagshipInfo = (slug: string): Flagship | undefined => FLAGSHIP_INFO[slug];
