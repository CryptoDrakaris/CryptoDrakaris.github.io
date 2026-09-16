export const LANGS = ['en', 'ru', 'kk'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

export const LANG_LABEL: Record<Lang, string> = { en: 'EN', ru: 'RU', kk: 'KZ' };
export const LANG_NAME: Record<Lang, string> = { en: 'English', ru: 'Русский', kk: 'Қазақша' };
// Intl locale used for dates, numbers and plural rules
export const LOCALE: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' };

export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const en = {
  'meta.tagline': 'NFT collector',
  'meta.description': 'Drakaris, NFT collector on Ethereum: Lazy Lions, Gray Boys, Bubblegum Kids, Robotos and more. The collection, notes on web3 and where to find me.',

  'nav.home': 'Home',
  'nav.collections': 'Collections',
  'nav.gallery': 'Gallery',
  'nav.blog': 'Blog',
  'nav.about': 'About',
  'nav.contact': 'Contact',
  'nav.menu': 'Menu',
  'nav.main': 'Main',
  'nav.mobile': 'Mobile menu',
  'nav.language': 'Language',
  'nav.skip': 'Skip to content',

  'home.eyebrow': 'Collector · Holder · Community',
  'home.title.1': "gm, I'm",
  'home.title.2': 'Drakaris.',
  'home.lead': 'I collect NFTs on Ethereum. Lazy Lions were my first love, and a whole zoo has gathered around them since.',
  'home.cta.collections': 'Explore collections',
  'home.cta.follow': 'Follow on X',
  'home.stat.tokens': 'NFTs',
  'home.stat.collections': 'collections',
  'home.stat.flagships': 'flagships',

  'home.flagships.eyebrow': 'Flagships',
  'home.flagships.title': 'Where my heart is',
  'home.flagships.lead': 'The projects I love most. Each one has its own page, dressed in its own style.',
  'home.others.eyebrow': 'The rest of the zoo',
  'home.others.title': 'Picked up along the way',
  'home.others.lead': 'More collections from the wallet, from CryptoKitties to space cats.',
  'home.others.cta': 'See all others',
  'home.blog.eyebrow': 'Blog',
  'home.blog.title': 'Latest notes',
  'home.blog.all': 'All posts',

  'join.eyebrow': 'Say hi',
  'join.title': 'Come say gm.',
  'join.lead': 'Into NFTs and web3? Follow me on X and TikTok: threads, videos and fresh finds from the wallet.',

  'collections.eyebrow': 'Collections',
  'collections.title': "Everything I've collected",
  'collections.lead': '{tokens} in {collections}. Flagships first, then the rest.',
  'collections.open': 'Open',

  'flagship.eyebrow': 'Flagship collection',
  'flagship.mine': 'In my wallet',
  'flagship.supply': 'Total supply',
  'flagship.since': 'Launched',
  'flagship.creator': 'Created by',
  'flagship.website': 'Website',
  'flagship.members': 'In this universe',
  'flagship.gallery': 'My {name}',
  'flagship.official': 'Official channels',
  'flagship.community.title': 'Join the {name} community.',
  'flagship.cta.gallery': 'See my pieces',
  'flagship.disclaimer': 'Fan page by a holder. Not affiliated with or endorsed by the {name} team.',

  'others.eyebrow': 'Collections',
  'others.title': 'Others',
  'others.lead': '{collections} that did not make the flagship list but still live in the wallet.',
  'others.jump': 'Jump to collection',

  'about.eyebrow': 'About',
  'about.title': "Hi, I'm Drakaris.",
  'about.lead': 'NFT collector, Lazy Lions holder and a regular in the web3 crowd. Online I go by @cryptodrakaris.',
  'about.me.title': 'Me',
  'about.me.text': 'I post about NFTs, web3 and collecting on X and TikTok. This site is where it all comes together: the collection, my notes and the communities I hang out in.',
  'about.wallet.title': 'The collection',
  'about.wallet.text': 'My wallet {ens} holds {tokens} across {collections}. Every token here is read straight from its contract on Ethereum, not from a marketplace.',
  'about.flagships.title': 'What I love most',
  'about.disclaimer': 'This is a personal collector site. It is not affiliated with or endorsed by any of the projects shown.',

  'gallery.eyebrow': 'Gallery',
  'gallery.title': 'The whole collection',
  'gallery.lead': 'Every token in {ens}. Tap a card for the full-size original and traits.',
  'gallery.filter.collection': 'Collection',
  'gallery.filter.group': 'Section',
  'gallery.filter.any': 'Any',
  'gallery.filter.all': 'All collections',
  'gallery.filter.flagships': 'Flagships',
  'gallery.filter.traitsHint': 'Pick a collection to filter by traits.',
  'gallery.filter.reset': 'Reset',
  'gallery.shown': 'Showing {shown} of {total}',
  'gallery.empty': 'Nothing matches these filters.',

  'token.traits': 'Traits',
  'token.details': 'Details',
  'token.about': 'About this piece',
  'token.collection': 'Collection',
  'token.contract': 'Contract',
  'token.tokenId': 'Token ID',
  'token.standard': 'Standard',
  'token.original': 'Open original',
  'token.opensea': 'OpenSea',
  'token.etherscan': 'Etherscan',
  'token.back': 'Back to {name}',
  'token.noPreview': 'No image preview for this token. The original opens in a new tab.',
  'token.source': 'Image source',
  'token.source.archive': "Web archive copy of the project's own file",
  'token.source.marketplace': 'Marketplace copy, re-encoded',
  'token.sourceNote': "The project's servers are gone, so this image is rescued from elsewhere and self-hosted.",
  'token.prev': 'Previous',
  'token.next': 'Next',

  'blog.eyebrow': 'Blog',
  'blog.title': 'Notes from the wallet',
  'blog.lead': 'NFTs, web3, the projects I collect and whatever else is on my mind.',
  'blog.empty': 'No posts in this language yet.',
  'blog.back': 'All posts',
  'blog.read': 'Read',

  'contact.eyebrow': 'Contact',
  'contact.title': 'Find me online.',
  'contact.lead': 'The fastest way to reach me is a DM on X.',
  'contact.x': 'News, threads and DMs',
  'contact.tiktok': 'Short videos about NFTs and web3',
  'contact.communities': 'Communities I hang out in',

  'footer.disclaimer': 'Personal collector site. Not affiliated with the projects shown.',
  'footer.art': 'Artwork belongs to its creators and is displayed by the token owner.',

  'nfts': { one: '{n} NFT', other: '{n} NFTs' } as Plural,
  'collectionsN': { one: '{n} collection', other: '{n} collections' } as Plural,
};

export type UIKey = keyof typeof en;

const ru: Record<UIKey, string | Plural> = {
  'meta.tagline': 'NFT-коллекционер',
  'meta.description': 'Drakaris, NFT-коллекционер на Ethereum: Lazy Lions, Gray Boys, Bubblegum Kids, Robotos и не только. Коллекция, заметки о web3 и где меня найти.',

  'nav.home': 'Главная',
  'nav.collections': 'Коллекции',
  'nav.gallery': 'Галерея',
  'nav.blog': 'Блог',
  'nav.about': 'Обо мне',
  'nav.contact': 'Контакты',
  'nav.menu': 'Меню',
  'nav.main': 'Основное меню',
  'nav.mobile': 'Мобильное меню',
  'nav.language': 'Язык',
  'nav.skip': 'Перейти к содержимому',

  'home.eyebrow': 'Коллекционер · Холдер · Комьюнити',
  'home.title.1': 'gm, я',
  'home.title.2': 'Drakaris.',
  'home.lead': 'Собираю NFT на Ethereum. Lazy Lions – первая любовь, а вокруг них с тех пор собрался целый зоопарк.',
  'home.cta.collections': 'Смотреть коллекции',
  'home.cta.follow': 'Читать в X',
  'home.stat.tokens': 'NFT',
  'home.stat.collections': 'коллекций',
  'home.stat.flagships': 'флагманов',

  'home.flagships.eyebrow': 'Флагманы',
  'home.flagships.title': 'Самое любимое',
  'home.flagships.lead': 'Проекты, которые мне ближе всего. У каждого своя страница в его собственном стиле.',
  'home.others.eyebrow': 'Остальной зоопарк',
  'home.others.title': 'Собрано по пути',
  'home.others.lead': 'Другие коллекции из кошелька: от CryptoKitties до космических котов.',
  'home.others.cta': 'Все остальные',
  'home.blog.eyebrow': 'Блог',
  'home.blog.title': 'Свежие заметки',
  'home.blog.all': 'Все записи',

  'join.eyebrow': 'На связи',
  'join.title': 'Заходи сказать gm.',
  'join.lead': 'Увлекаешься NFT и web3? Подписывайся в X и TikTok: треды, видео и свежие находки из кошелька.',

  'collections.eyebrow': 'Коллекции',
  'collections.title': 'Всё, что я собрал',
  'collections.lead': '{tokens}, {collections}. Сначала флагманы, потом всё остальное.',
  'collections.open': 'Открыть',

  'flagship.eyebrow': 'Флагманская коллекция',
  'flagship.mine': 'В моём кошельке',
  'flagship.supply': 'Всего токенов',
  'flagship.since': 'Запуск',
  'flagship.creator': 'Автор',
  'flagship.website': 'Сайт',
  'flagship.members': 'В этой вселенной',
  'flagship.gallery': 'Мои {name}',
  'flagship.official': 'Официальные каналы',
  'flagship.community.title': 'Заходи в комьюнити {name}.',
  'flagship.cta.gallery': 'Мои токены',
  'flagship.disclaimer': 'Фан-страница холдера. Не связана с командой {name} и не одобрена ею.',

  'others.eyebrow': 'Коллекции',
  'others.title': 'Другие',
  'others.lead': 'Ещё {collections}: не попали во флагманы, но живут в кошельке.',
  'others.jump': 'Перейти к коллекции',

  'about.eyebrow': 'Обо мне',
  'about.title': 'Привет, я Drakaris.',
  'about.lead': 'NFT-коллекционер, холдер Lazy Lions и свой человек в web3. В сети меня зовут @cryptodrakaris.',
  'about.me.title': 'Кто я',
  'about.me.text': 'Пишу и снимаю про NFT, web3 и коллекционирование в X и TikTok. Этот сайт собирает всё вместе: коллекцию, заметки и комьюнити, в которых я тусуюсь.',
  'about.wallet.title': 'Коллекция',
  'about.wallet.text': 'В кошельке {ens} сейчас {tokens} – {collections}. Каждый токен на сайте прочитан напрямую из контракта Ethereum, а не с маркетплейса.',
  'about.flagships.title': 'Что я люблю больше всего',
  'about.disclaimer': 'Это личный сайт коллекционера. Он не связан ни с одним из показанных проектов и не одобрен ими.',

  'gallery.eyebrow': 'Галерея',
  'gallery.title': 'Вся коллекция',
  'gallery.lead': 'Все токены из {ens}. Нажми на карточку, чтобы открыть оригинал и признаки.',
  'gallery.filter.collection': 'Коллекция',
  'gallery.filter.group': 'Раздел',
  'gallery.filter.any': 'Любой',
  'gallery.filter.all': 'Все коллекции',
  'gallery.filter.flagships': 'Флагманы',
  'gallery.filter.traitsHint': 'Выбери коллекцию, чтобы фильтровать по признакам.',
  'gallery.filter.reset': 'Сбросить',
  'gallery.shown': 'Показано {shown} из {total}',
  'gallery.empty': 'Под эти фильтры ничего нет.',

  'token.traits': 'Признаки',
  'token.details': 'Детали',
  'token.about': 'Об этом токене',
  'token.collection': 'Коллекция',
  'token.contract': 'Контракт',
  'token.tokenId': 'Token ID',
  'token.standard': 'Стандарт',
  'token.original': 'Открыть оригинал',
  'token.opensea': 'OpenSea',
  'token.etherscan': 'Etherscan',
  'token.back': 'Назад к {name}',
  'token.noPreview': 'Для этого токена нет превью. Оригинал откроется в новой вкладке.',
  'token.source': 'Источник изображения',
  'token.source.archive': 'Копия файла проекта из веб-архива',
  'token.source.marketplace': 'Копия с маркетплейса, пережата',
  'token.sourceNote': 'Серверы проекта недоступны, поэтому изображение восстановлено из другого источника и хранится у нас.',
  'token.prev': 'Предыдущий',
  'token.next': 'Следующий',

  'blog.eyebrow': 'Блог',
  'blog.title': 'Заметки из кошелька',
  'blog.lead': 'NFT, web3, проекты, которые я собираю, и всё, что приходит в голову.',
  'blog.empty': 'На этом языке записей пока нет.',
  'blog.back': 'Все записи',
  'blog.read': 'Читать',

  'contact.eyebrow': 'Контакты',
  'contact.title': 'Где меня найти.',
  'contact.lead': 'Быстрее всего ответ придёт в личные сообщения в X.',
  'contact.x': 'Новости, треды и личка',
  'contact.tiktok': 'Короткие видео про NFT и web3',
  'contact.communities': 'Комьюнити, где я бываю',

  'footer.disclaimer': 'Личный сайт коллекционера. Не связан с показанными проектами.',
  'footer.art': 'Права на изображения принадлежат авторам, показ – владельцем токенов.',

  'nfts': { other: '{n} NFT' },
  // nominative with a number; sentences below are phrased so the count stays nominative
  'collectionsN': { one: '{n} коллекция', few: '{n} коллекции', many: '{n} коллекций', other: '{n} коллекции' },
};

// TODO(owner): Kazakh copy is a first draft, worth a native-speaker pass.
const kk: Record<UIKey, string | Plural> = {
  'meta.tagline': 'NFT коллекционері',
  'meta.description': 'Drakaris – Ethereum желісіндегі NFT коллекционері: Lazy Lions, Gray Boys, Bubblegum Kids, Robotos және басқалар. Коллекция, web3 туралы жазбалар және байланыс.',

  'nav.home': 'Басты бет',
  'nav.collections': 'Коллекциялар',
  'nav.gallery': 'Галерея',
  'nav.blog': 'Блог',
  'nav.about': 'Мен туралы',
  'nav.contact': 'Байланыс',
  'nav.menu': 'Мәзір',
  'nav.main': 'Негізгі мәзір',
  'nav.mobile': 'Мобильді мәзір',
  'nav.language': 'Тіл',
  'nav.skip': 'Мазмұнға өту',

  'home.eyebrow': 'Коллекционер · Холдер · Қауымдастық',
  'home.title.1': 'gm, мен',
  'home.title.2': 'Drakaris.',
  'home.lead': 'Ethereum желісінде NFT жинаймын. Lazy Lions – алғашқы махаббатым, содан бері айналасына тұтас хайуанаттар бағы жиналды.',
  'home.cta.collections': 'Коллекцияларды көру',
  'home.cta.follow': 'X-те оқу',
  'home.stat.tokens': 'NFT',
  'home.stat.collections': 'коллекция',
  'home.stat.flagships': 'флагман',

  'home.flagships.eyebrow': 'Флагмандар',
  'home.flagships.title': 'Ең жақсы көретіндерім',
  'home.flagships.lead': 'Маған ең жақын жобалар. Әрқайсысының өз стиліндегі жеке беті бар.',
  'home.others.eyebrow': 'Қалған хайуанаттар бағы',
  'home.others.title': 'Жол бойы жиналғандар',
  'home.others.lead': 'Әмияндағы басқа коллекциялар: CryptoKitties-тен ғарыш мысықтарына дейін.',
  'home.others.cta': 'Қалғандарының бәрі',
  'home.blog.eyebrow': 'Блог',
  'home.blog.title': 'Соңғы жазбалар',
  'home.blog.all': 'Барлық жазбалар',

  'join.eyebrow': 'Байланыста',
  'join.title': 'Кіріп, gm де.',
  'join.lead': 'NFT мен web3 қызықтыра ма? X пен TikTok-та жазыл: тредтер, видеолар және әмияннан жаңа олжалар.',

  'collections.eyebrow': 'Коллекциялар',
  'collections.title': 'Жинағанымның бәрі',
  'collections.lead': '{collections} ішінде {tokens}. Алдымен флагмандар, содан кейін қалғандары.',
  'collections.open': 'Ашу',

  'flagship.eyebrow': 'Флагман коллекция',
  'flagship.mine': 'Менің әмиянымда',
  'flagship.supply': 'Барлық токен',
  'flagship.since': 'Іске қосылған',
  'flagship.creator': 'Авторы',
  'flagship.website': 'Сайт',
  'flagship.members': 'Осы әлемде',
  'flagship.gallery': 'Менің {name}',
  'flagship.official': 'Ресми арналар',
  'flagship.community.title': '{name} қауымдастығына қосыл.',
  'flagship.cta.gallery': 'Менің токендерім',
  'flagship.disclaimer': 'Холдердің фан-беті. {name} командасымен байланысты емес және олар мақұлдамаған.',

  'others.eyebrow': 'Коллекциялар',
  'others.title': 'Басқалар',
  'others.lead': 'Флагмандарға кірмеген, бірақ әмиянда тұрған {collections}.',
  'others.jump': 'Коллекцияға өту',

  'about.eyebrow': 'Мен туралы',
  'about.title': 'Сәлем, мен Drakaris.',
  'about.lead': 'NFT коллекционері, Lazy Lions холдері, web3 ортасының өз адамы. Желіде мені @cryptodrakaris деп табасың.',
  'about.me.title': 'Мен кіммін',
  'about.me.text': 'X пен TikTok-та NFT, web3 және коллекция жинау туралы жазамын. Бұл сайт бәрін бір жерге жинайды: коллекция, жазбалар және мен жүретін қауымдастықтар.',
  'about.wallet.title': 'Коллекция',
  'about.wallet.text': '{ens} әмиянында қазір {collections} ішінде {tokens} бар. Сайттағы әр токен маркетплейстен емес, тікелей Ethereum келісімшартынан оқылған.',
  'about.flagships.title': 'Ең жақсы көретінім',
  'about.disclaimer': 'Бұл – коллекционердің жеке сайты. Көрсетілген жобалардың ешқайсысымен байланысты емес және олар мақұлдамаған.',

  'gallery.eyebrow': 'Галерея',
  'gallery.title': 'Бүкіл коллекция',
  'gallery.lead': '{ens} ішіндегі барлық токендер. Түпнұсқа мен белгілерді көру үшін карточканы бас.',
  'gallery.filter.collection': 'Коллекция',
  'gallery.filter.group': 'Бөлім',
  'gallery.filter.any': 'Кез келген',
  'gallery.filter.all': 'Барлық коллекциялар',
  'gallery.filter.flagships': 'Флагмандар',
  'gallery.filter.traitsHint': 'Белгілер бойынша сүзу үшін коллекцияны таңда.',
  'gallery.filter.reset': 'Тазалау',
  'gallery.shown': '{total} ішінен {shown} көрсетілді',
  'gallery.empty': 'Бұл сүзгілерге сай ештеңе жоқ.',

  'token.traits': 'Белгілер',
  'token.details': 'Мәліметтер',
  'token.about': 'Бұл токен туралы',
  'token.collection': 'Коллекция',
  'token.contract': 'Келісімшарт',
  'token.tokenId': 'Token ID',
  'token.standard': 'Стандарт',
  'token.original': 'Түпнұсқаны ашу',
  'token.opensea': 'OpenSea',
  'token.etherscan': 'Etherscan',
  'token.back': '{name} бөліміне оралу',
  'token.noPreview': 'Бұл токеннің алдын ала көрінісі жоқ. Түпнұсқа жаңа қойындыда ашылады.',
  'token.source': 'Сурет көзі',
  'token.source.archive': 'Жоба файлының веб-архивтегі көшірмесі',
  'token.source.marketplace': 'Маркетплейстен алынған көшірме, қайта сығылған',
  'token.sourceNote': 'Жобаның серверлері жұмыс істемейді, сондықтан сурет басқа көзден қалпына келтіріліп, бізде сақталады.',
  'token.prev': 'Алдыңғы',
  'token.next': 'Келесі',

  'blog.eyebrow': 'Блог',
  'blog.title': 'Әмияннан жазбалар',
  'blog.lead': 'NFT, web3, мен жинайтын жобалар және ойға келген басқа да тақырыптар.',
  'blog.empty': 'Бұл тілде әзірге жазба жоқ.',
  'blog.back': 'Барлық жазбалар',
  'blog.read': 'Оқу',

  'contact.eyebrow': 'Байланыс',
  'contact.title': 'Мені қайдан табуға болады.',
  'contact.lead': 'Ең жылдам жол – X-те жеке хабарлама жазу.',
  'contact.x': 'Жаңалықтар, тредтер және жеке хабарлар',
  'contact.tiktok': 'NFT және web3 туралы қысқа видеолар',
  'contact.communities': 'Мен жүретін қауымдастықтар',

  'footer.disclaimer': 'Коллекционердің жеке сайты. Көрсетілген жобалармен байланысты емес.',
  'footer.art': 'Суреттердің құқығы авторларға тиесілі, оларды токен иесі көрсетеді.',

  'nfts': { other: '{n} NFT' },
  'collectionsN': { other: '{n} коллекция' },
};

const dict: Record<Lang, Record<UIKey, string | Plural>> = { en, ru, kk };

export function useT(lang: Lang) {
  const plural = new Intl.PluralRules(LOCALE[lang]);
  const nf = new Intl.NumberFormat(LOCALE[lang]);
  const fill = (s: string, vars: Record<string, string | number> = {}) =>
    s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(typeof vars[k] === 'number' ? nf.format(vars[k] as number) : vars[k]) : `{${k}}`));

  function t(key: UIKey, vars?: Record<string, string | number>): string {
    const v = dict[lang][key] ?? en[key];
    if (typeof v !== 'string') throw new Error(`"${key}" is a plural key, use tn()`);
    return fill(v, vars);
  }

  /** Plural form; pass a Plural object directly for copy that lives outside this dictionary. */
  function tn(key: UIKey | Plural, n: number, vars: Record<string, string | number> = {}): string {
    const v = (typeof key === 'string' ? (dict[lang][key] ?? en[key]) : key) as Plural;
    const form = v[plural.select(n)] ?? v.other;
    return fill(form, { n, ...vars });
  }

  return { t, tn, nf };
}

export function isLang(x: unknown): x is Lang {
  return LANGS.includes(x as Lang);
}
