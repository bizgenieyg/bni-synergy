'use strict';

/**
 * Import social links and Hebrew professions from the reference PDF.
 * Data pre-parsed from: Члены BNI.pdf
 *
 * Run: node scripts/import-socials-from-pdf.js
 */

const Database  = require('better-sqlite3');
const path      = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/guests.db');
const db      = new Database(DB_PATH);

// Ensure profession_he column exists (same migration as server.js)
try { db.exec("ALTER TABLE members ADD COLUMN profession_he TEXT NOT NULL DEFAULT ''"); } catch {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wa(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return `https://wa.me/${d}`;
}

function ig(handle)  { return `https://www.instagram.com/${handle.replace(/^@/, '')}`; }
function fb(page)    { return `https://www.facebook.com/${page.replace(/\s/g, '')}`; }
function tg(handle)  { return `https://t.me/${handle.replace(/^@/, '')}`; }
function tk(handle)  { return `https://www.tiktok.com/@${handle.replace(/^@/, '')}`; }
function yt(handle)  { return `https://www.youtube.com/@${handle.replace(/^@/, '')}`; }
function li(handle)  { return `https://www.linkedin.com/in/${handle.replace(/^@/, '')}`; }
function web(url)    { return url.startsWith('http') ? url : `https://${url}`; }
function email(addr) { return `mailto:${addr}`; }

// ─── Member data (parsed from Члены BNI.pdf) ──────────────────────────────────
// dbName    — exact name as stored in the DB (for matching)
// profession_he — Hebrew profession from PDF
// professionRu  — updated Russian profession (null = keep existing)
// socials       — array of { platform, url, label }

const MEMBERS = [
  {
    dbName: 'Татьяна Лев',
    profession_he: 'יועצת עסקית ומנטלית',
    professionRu: 'бизнес-наставник и нейро-коуч',
    socials: [
      { platform: 'instagram', url: ig('tanya_lev_il'),   label: '@tanya_lev_il' },
      { platform: 'whatsapp',  url: wa('0526331457'),     label: '0526331457' },
      { platform: 'telegram',  url: tg('tatyana-lev'),    label: 'PRO Систему и стратегию | Татьяна Лев' },
      { platform: 'facebook',  url: fb('tanyalev'),       label: 'Таня Лев' },
      { platform: 'facebook',  url: fb('TatianaLev'),     label: 'Tatiana Lev' },
      { platform: 'tiktok',    url: tk('tatiana_lev_il'), label: '@tatiana_lev_il' },
    ],
  },
  {
    dbName: 'Лена Смолкин',
    profession_he: 'יעוץ תדמית וסטיילינג',
    professionRu: 'стилист и владелица ателье',
    socials: [
      { platform: 'instagram', url: ig('elenasmolkin'),        label: '@elenasmolkin' },
      { platform: 'whatsapp',  url: wa('0544744053'),          label: '0544744053' },
      { platform: 'telegram',  url: tg('smolkin_elena'),       label: '"ДЕТОКС ГАРДЕРОБА" с Еленой Смолкиной' },
      { platform: 'facebook',  url: fb('ElenaSmolkin'),        label: 'ElenaSmolkin' },
      { platform: 'facebook',  url: fb('stylingElena'),        label: 'סטיילינג עם ילנה סמולקין' },
      { platform: 'tiktok',    url: tk('smolkin_elena'),       label: '@smolkin_elena' },
    ],
  },
  {
    dbName: 'Дариен Ройтман',
    profession_he: 'אקדמיה AI לעסקים',
    professionRu: 'основатель PixAI Academy. Контент. Профессия. AI.',
    socials: [
      { platform: 'instagram', url: ig('darienroytman'),          label: '@darienroytman' },
      { platform: 'whatsapp',  url: wa('0545919330'),             label: '0545919330' },
      { platform: 'website',   url: web('pixaidreamstudio.com'),  label: 'pixaidreamstudio' },
      { platform: 'facebook',  url: fb('darienroytman'),          label: 'Дариен Шауль Ройтман' },
      { platform: 'tiktok',    url: tk('darienroytman'),          label: '@darienroytman' },
      { platform: 'linkedin',  url: li('darien-roytman'),         label: 'Darien S. Roytman Ph.D.' },
    ],
  },
  {
    dbName: 'Дарья Марис',
    profession_he: 'אומנית דקור פנים',
    professionRu: 'художник-декоратор интерьера',
    socials: [
      { platform: 'instagram', url: ig('dar_art_design'), label: '@dar_art_design' },
      { platform: 'whatsapp',  url: wa('0587060973'),     label: '0587060973' },
      { platform: 'facebook',  url: fb('DaryaMaris'),     label: 'Darya Maris' },
    ],
  },
  {
    dbName: 'Виктория Фогель',
    profession_he: 'עו"ד נדל"ן',
    professionRu: 'адвокат по недвижимости',
    socials: [
      { platform: 'instagram', url: ig('viktoriafogellawfirm'),         label: 'viktoriafogellawfirm' },
      { platform: 'whatsapp',  url: wa('0525681177'),                   label: '0525681177' },
      { platform: 'website',   url: web('vfogel-law.com'),              label: 'vfogel-law.com' },
      { platform: 'facebook',  url: fb('FogelViktoriaAdv'),             label: 'Fogel Viktoria Adv - עו"ד ויקטוריה פוגל' },
    ],
  },
  {
    dbName: 'Диана Шаривкер',
    profession_he: 'סוכנות ביטוח חיים / אלמנטרי / פנסיה',
    professionRu: 'страховое агентство',
    socials: [
      { platform: 'instagram', url: ig('sharivkerdiana'),           label: '@sharivkerdiana' },
      { platform: 'whatsapp',  url: wa('0503399829'),               label: '0503399829' },
      { platform: 'facebook',  url: fb('DianaSharevker'),           label: 'Diana Sharivker' },
      { platform: 'facebook',  url: fb('DianaSharevkerAshdod'),     label: 'Страховое агенство Diana Sharivker | Ashdod' },
      { platform: 'tiktok',    url: tk('dianasharivker'),           label: '@dianasharivker' },
    ],
  },
  {
    dbName: 'Рита Хазанович',
    profession_he: 'רו"ח',
    professionRu: 'аудитор',
    socials: [
      { platform: 'whatsapp', url: wa('0545809092'), label: '0545809092' },
    ],
  },
  {
    dbName: 'Игорь Лупинский',
    profession_he: 'הנהלת חשבונות',
    professionRu: 'бухгалтерия',
    socials: [
      { platform: 'website',  url: web('taxpayers.bitrix24.ru'), label: 'taxpayers.bitrix24' },
      { platform: 'whatsapp', url: wa('0505812236'),             label: '0505812236' },
    ],
  },
  {
    dbName: 'Александр Коско',
    profession_he: 'מיומנות דיבור מול קהל',
    professionRu: 'ведущий тренингов по голосу и ораторскому искусству',
    socials: [
      { platform: 'instagram', url: ig('alexanderkosko'), label: '@alexanderkosko' },
      { platform: 'whatsapp',  url: wa('0528966740'),     label: '0528966740' },
      { platform: 'facebook',  url: fb('Александр-Коско'), label: 'Александр Коско' },
    ],
  },
  {
    dbName: 'Евгений Сидельский',
    profession_he: 'בית דפוס',
    professionRu: 'типография',
    socials: [
      { platform: 'instagram', url: ig('sidelskijevgen'),  label: '@sidelskijevgen' },
      { platform: 'whatsapp',  url: wa('0546554221'),      label: '0546554221' },
      { platform: 'facebook',  url: fb('All4you247'),      label: 'All4you247.com' },
      { platform: 'tiktok',    url: tk('slaiderroom'),     label: '@slaiderroom' },
    ],
  },
  {
    dbName: 'Евгения Писман',
    profession_he: 'כותבת תוכן',
    professionRu: 'копирайтер',
    socials: [
      { platform: 'facebook',  url: fb('GeniaWr'),     label: 'Genia W-r' },
      { platform: 'whatsapp',  url: wa('0503204861'),  label: '0503204861' },
    ],
  },
  {
    dbName: 'Ольга Грановская',
    profession_he: 'SarafanPRO — קידום SEO AI Deep Research בגוגל',
    professionRu: 'интернет-маркетинг, продвижение, SEO и AI',
    socials: [
      { platform: 'instagram', url: ig('sarafanpro.israel'),  label: '@sarafanpro.israel' },
      { platform: 'instagram', url: ig('olgagrano.il'),       label: '@olgagrano.il' },
      { platform: 'whatsapp',  url: wa('0535390080'),         label: '0535390080' },
      { platform: 'facebook',  url: fb('sarafanproil'),       label: 'sarafanproil' },
      { platform: 'facebook',  url: fb('BizClubSarafanPRO'),  label: 'Бизнес-клуб SarafanPRO' },
      { platform: 'facebook',  url: fb('OlgaGranovskaya'),    label: 'Olga Granovskaya' },
      { platform: 'website',   url: web('sarafanpro.com'),    label: 'sarafanpro.com' },
    ],
  },
  {
    dbName: 'Сабина Эренштейн',
    profession_he: 'מגשרת משפחתית',
    professionRu: 'медиатор в семейной сфере',
    socials: [
      { platform: 'facebook',  url: fb('SabinaErenshtein'), label: 'Sabina Erenshtein' },
      { platform: 'whatsapp',  url: wa('0526775571'),       label: '0526775571' },
    ],
  },
  {
    dbName: 'Дмитрий Мельгорский',
    profession_he: 'עיצוב גרפי ובניית אתרים',
    professionRu: 'AI-видео контент | графический дизайн и создание сайтов',
    socials: [
      { platform: 'instagram', url: ig('dmitrimelgorski'),    label: '@dmitrimelgorski' },
      { platform: 'whatsapp',  url: wa('0539290639'),         label: '0539290639' },
      { platform: 'facebook',  url: fb('DmitriMelgorski'),    label: 'Dmitri Melgorski' },
      { platform: 'tiktok',    url: tk('dmitriimelgorskii'),  label: '@dmitriimelgorskii' },
    ],
  },
  {
    dbName: 'Ольга Гасперт',
    profession_he: 'עיצוב מפרחים טריים ומשי',
    professionRu: 'флорист',
    socials: [
      { platform: 'instagram', url: ig('olga_gaspert_kaleydoskop'), label: '@olga_gaspert_kaleydoskop' },
      { platform: 'whatsapp',  url: wa('0528191040'),               label: '0528191040' },
      { platform: 'facebook',  url: fb('kaleydoskopOlga'),          label: 'קליידוסקופ אולגה' },
      { platform: 'telegram',  url: tg('HomeDecorIsrael'),          label: 'Home decor Israel' },
    ],
  },
  {
    dbName: 'Ирина Заманская',
    profession_he: 'ציורי פנים וגוף',
    professionRu: 'аквагример',
    socials: [
      { platform: 'instagram', url: ig('artfacetlv'),       label: '@artfacetlv' },
      { platform: 'facebook',  url: fb('IrinaZamanskaya'), label: 'Ирина Заманская' },
      { platform: 'whatsapp',  url: wa('0585040567'),       label: '0585040567' },
    ],
  },
  {
    dbName: 'Сергей Фишбах',
    profession_he: 'צלם/וידאו לאירועים',
    professionRu: 'съемка торжеств и мероприятий, фототерапия',
    socials: [
      { platform: 'facebook',  url: fb('SergeyFishbakh'), label: 'Сергей Фишбах' },
      { platform: 'whatsapp',  url: wa('0502714814'),     label: '0502714814' },
    ],
  },
  {
    // DB name: 'Мила Рассказов Чирков'
    dbName: 'Мила Рассказов Чирков',
    profession_he: 'קייטרינג/עוגות וקינוחים/סדנאות',
    professionRu: 'Кейтеринг/Фуршеты/Торты/Мастер классы',
    socials: [
      { platform: 'instagram', url: ig('ludmila_rasskazov_chircov_'), label: '@ludmila_rasskazov_chircov_' },
      { platform: 'whatsapp',  url: wa('0526765562'),                 label: '0526765562' },
      { platform: 'facebook',  url: fb('LudmilaRasskazov'),           label: 'Ludmila Rasskazov' },
    ],
  },
  {
    dbName: 'Татьяна Вайс',
    profession_he: 'עו"ד דיני תעבורה ופלילי',
    professionRu: 'адвокат по дорожному и уголовному праву',
    socials: [
      { platform: 'instagram', url: ig('tatyana.wyss.adv'),  label: '@tatyana.wyss.adv' },
      { platform: 'whatsapp',  url: wa('0546960404'),        label: '0546960404' },
      { platform: 'facebook',  url: fb('TatyanaWyssAdv'),    label: 'Tatyana Wyss Adv' },
    ],
  },
  {
    dbName: 'Леонид Лурия',
    profession_he: 'לוריא קוסמטיקס בע"מ',
    professionRu: 'разработчик и производитель косметики',
    socials: [
      { platform: 'other',    url: email('leonid.lurya@gmail.com'), label: 'leonid.lurya@gmail.com' },
      { platform: 'whatsapp', url: wa('0544956734'),                label: '0544956734' },
      { platform: 'linkedin', url: li('leonid-luriya'),             label: '@leonid-luriya' },
    ],
  },
  {
    dbName: 'Алексей Поповских',
    profession_he: 'מעסה רפואי',
    professionRu: 'массажный терапевт',
    socials: [
      { platform: 'instagram', url: ig('medical_massage.rishonlezion'), label: '@medical_massage.rishonlezion' },
      { platform: 'whatsapp',  url: wa('0522751187'),                   label: '0522751187' },
      { platform: 'facebook',  url: fb('AlekseyPopovskikh'),             label: 'Алексей Поповских' },
      { platform: 'facebook',  url: fb('MedicalMassageIsrael'),          label: 'Medical.Massage.Israel' },
    ],
  },
  {
    dbName: 'Тэнзиля Коренберг',
    profession_he: 'מעצבת שיער',
    professionRu: 'парикмахер стилист',
    socials: [
      { platform: 'whatsapp', url: wa('0534453912'), label: '0534453912' },
    ],
  },
  {
    dbName: 'Александр Кудинов',
    profession_he: 'בית ספר לכלכלת המשפחה "איפה הכסף?"',
    professionRu: 'консультант по семейным финансам',
    socials: [
      { platform: 'instagram', url: ig('gde.moidengi'),            label: '@gde.moidengi' },
      { platform: 'whatsapp',  url: wa('0549019324'),              label: '0549019324' },
      { platform: 'website',   url: web('gmd.witm.info'),          label: 'gmd.witm.info' },
      { platform: 'facebook',  url: fb('GdeMoidengiGivatayim'),    label: "Где мои деньги? | Giv'atayim" },
      { platform: 'telegram',  url: tg('gdemoidengi'),             label: '@gdemoidengi' },
    ],
  },
  {
    dbName: 'Ирина Кроль',
    profession_he: 'מספרת כלבים',
    professionRu: 'груммер',
    socials: [
      { platform: 'instagram', url: ig('irakrollulkin'),        label: '@irakrollulkin' },
      { platform: 'whatsapp',  url: wa('0523986032'),           label: '0523986032' },
      { platform: 'facebook',  url: fb('IrinaKrolLylkina'),     label: 'Ирина Кроль Люлькина' },
      { platform: 'facebook',  url: fb('BarkiRehovot'),         label: 'Barki - לבעלי החיים הטובים | Rehovot' },
      { platform: 'tiktok',    url: tk('irina.koronaterra'),    label: '@irina.koronaterra' },
    ],
  },
  {
    dbName: 'Марта Штайнберг',
    profession_he: 'מתוקים טבעיים',
    professionRu: 'пастилатье, витаминные роллы ручной работы',
    socials: [
      { platform: 'instagram', url: ig('martas_fruitina'),        label: '@martas_fruitina' },
      { platform: 'whatsapp',  url: wa('0526074257'),             label: '0526074257' },
      { platform: 'facebook',  url: fb('MartaShteinberg'),        label: 'Marta Shteinberg' },
      { platform: 'facebook',  url: fb('MartasFruitinaTelAviv'),  label: "Marta's Fruitina | Tel Aviv" },
    ],
  },
  {
    dbName: 'Даниель Биленсон',
    profession_he: 'עו"ד ניזיקין וביטוח לאומי',
    professionRu: 'адвокат по возмещению ущерба здоровью и имуществу',
    socials: [
      { platform: 'whatsapp', url: wa('0546444999'),       label: '0546444999' },
      { platform: 'website',  url: web('bn-law.co.il'),    label: 'bn-law.co.il' },
      { platform: 'facebook', url: fb('DanielBilinsonAdv'), label: 'Daniel Bilinson Adv' },
    ],
  },
  {
    dbName: 'Натали Жук',
    profession_he: 'שפית ביתית',
    professionRu: 'шеф-повар домашней кухни',
    socials: [
      { platform: 'instagram', url: ig('nato.zhuk'),                   label: '@nato.zhuk' },
      { platform: 'whatsapp',  url: wa('0587958060'),                  label: '0587958060' },
      { platform: 'facebook',  url: fb('NataliyaZhuk'),                label: 'Наталия Жук' },
      { platform: 'other',     url: email('tamarapavlovna1936@gmail.com'), label: 'tamarapavlovna1936@gmail.com' },
    ],
  },
  {
    dbName: 'Людмила Губарева',
    profession_he: 'NLP + אימון',
    professionRu: 'Коуч + НЛП',
    socials: [
      { platform: 'facebook',  url: fb('LudmilaGubareva'), label: 'Людмила Губарева' },
      { platform: 'whatsapp',  url: wa('0534882340'),      label: '0534882340' },
    ],
  },
  {
    dbName: 'Михаил Ткач',
    profession_he: 'מתווך בירת הנגב ואיזור הדרום',
    professionRu: 'риэлтор Беэр-Шева и Южный округ',
    socials: [
      { platform: 'whatsapp', url: wa('0545619163'),              label: '0545619163' },
      { platform: 'website',  url: web('mishatkach-realtor.com'), label: 'mishatkach-realtor.com' },
      { platform: 'facebook', url: fb('MishaTkach'),              label: 'Misha Tkach' },
      { platform: 'other',    url: email('realtor.misha@gmail.com'), label: 'realtor.misha@gmail.com' },
    ],
  },
  {
    dbName: 'Юля Тронза',
    profession_he: 'יועצת נדל"ן, יבנה ושפלה',
    professionRu: 'агентство недвижимости Явне',
    socials: [
      { platform: 'whatsapp', url: wa('0544757547'),           label: '0544757547' },
      { platform: 'other',    url: email('Julia.tronza@gmail.com'), label: 'Julia.tronza@gmail.com' },
      { platform: 'facebook', url: fb('JuliaTronzaRealEstate'), label: 'Julia Tronza Real Estate' },
    ],
  },
  {
    dbName: 'Виктория Колтун',
    profession_he: 'מגה מקס הובלות',
    professionRu: 'Мега Макс Перевозки',
    socials: [
      { platform: 'instagram', url: ig('mega_max_moving'),    label: '@mega_max_moving' },
      { platform: 'whatsapp',  url: wa('0546815561'),         label: '0546815561' },
      { platform: 'whatsapp',  url: wa('0546815562'),         label: 'מגה מקס הובלות' },
      { platform: 'facebook',  url: fb('megamaxmoving'),      label: 'megamaxmoving' },
      { platform: 'facebook',  url: fb('megamaxhovalot'),     label: 'megamaxhovalot' },
      { platform: 'website',   url: web('megamax.co.il'),     label: 'megamax.co.il' },
      { platform: 'tiktok',    url: tk('mega_max_moving'),    label: '@mega_max_moving' },
    ],
  },
  {
    dbName: 'Олег Волох',
    profession_he: 'יועץ משכנתאות ואשראי',
    professionRu: 'консультант по ипотекам',
    socials: [
      { platform: 'instagram', url: ig('olegvolokh'),   label: '@olegvolokh' },
      { platform: 'whatsapp',  url: wa('0546690524'),   label: '0546690524' },
      { platform: 'facebook',  url: fb('OlegVolokh'),   label: 'Олег Волох' },
      { platform: 'tiktok',    url: tk('olegvolokh5'),  label: '@olegvolokh5' },
    ],
  },
  {
    dbName: 'Лора Блантер',
    profession_he: 'Cartel בוטיק אופנה',
    professionRu: 'бутик Cartel',
    socials: [
      { platform: 'instagram', url: ig('cartelstyle'),            label: '@cartelstyle' },
      { platform: 'whatsapp',  url: wa('0548041987'),             label: '0548041987' },
      { platform: 'facebook',  url: fb('CartelStyleRishonLeZion'), label: 'Cartel Style | Rishon Le Zion' },
      { platform: 'tiktok',    url: tk('cartelstyle'),             label: '@cartelstyle' },
    ],
  },
  {
    dbName: 'Марина Кондратьев',
    profession_he: 'קוסמטיקאית',
    professionRu: 'косметолог',
    socials: [
      { platform: 'instagram', url: ig('m.k.beauty_marina'),        label: '@m.k.beauty_marina' },
      { platform: 'whatsapp',  url: wa('0509887199'),               label: '0509887199' },
      { platform: 'facebook',  url: fb('MKBeautyRishonLeZion'),     label: 'M.K.Beauty | Rishon Le Zion' },
    ],
  },
  {
    dbName: 'Андрей Скиба',
    profession_he: "די ג'יי סקיבה",
    professionRu: 'диджей',
    socials: [
      { platform: 'instagram', url: ig('andrew_skiba'), label: '@andrew_skiba' },
      { platform: 'whatsapp',  url: wa('0547602162'),   label: '0547602162' },
      { platform: 'facebook',  url: fb('AndrewSkiba'),  label: 'Andrew Skiba' },
    ],
  },
  {
    dbName: 'Артур Блаер',
    profession_he: 'עו"ד דיני הגירה ומעמד בישראל',
    professionRu: 'адвокат по репатриации и иммиграции',
    socials: [
      { platform: 'instagram', url: ig('arthur_blaer'),   label: '@arthur_blaer' },
      { platform: 'whatsapp',  url: wa('0546469080'),     label: '0546469080' },
      { platform: 'website',   url: web('blaerlaw.com'),  label: 'blaerlaw.com' },
      { platform: 'facebook',  url: fb('ArthurBlaerAdv'), label: 'ArthurBlaerAdv' },
      { platform: 'tiktok',    url: tk('arth_blaer'),     label: '@arth_blaer' },
      { platform: 'youtube',   url: yt('ArthurBlaer'),    label: '@ArthurBlaer' },
    ],
  },
  {
    dbName: 'Юрий Голд',
    profession_he: 'אוטומציה עסקית',
    professionRu: 'автоматизация бизнеса',
    socials: [
      { platform: 'facebook',  url: fb('BizGenie4U'),  label: 'BizGenie4U' },
      { platform: 'whatsapp',  url: wa('0525159393'),  label: '0525159393' },
    ],
  },
  {
    dbName: 'Шарон Соколовски',
    profession_he: 'עורכת דין חדלות פירעון',
    professionRu: 'адвокат по долговому праву',
    socials: [
      { platform: 'instagram', url: ig('sharon_sokolovsky_adv'),     label: 'sharon_sokolovsky_adv' },
      { platform: 'whatsapp',  url: wa('0547394897'),                label: '0547394897' },
      { platform: 'facebook',  url: fb('SharonSokolovskyAdv'),      label: 'שרון סוקולובסקי עו"ד' },
      { platform: 'website',   url: web('sokolovsky-law.co.il'),     label: 'sokolovsky-law.co.il' },
    ],
  },
  {
    dbName: 'Игорь Бутин',
    profession_he: 'הנדימן-חשמלאי',
    professionRu: 'хендимен-электрик',
    socials: [
      { platform: 'instagram', url: ig('igorbutin'),         label: '@igorbutin' },
      { platform: 'whatsapp',  url: wa('0533711029'),        label: '0533711029' },
      { platform: 'facebook',  url: fb('DomashnyMaster'),   label: 'Домашний мастер' },
    ],
  },
  {
    dbName: 'Антон Михеев',
    profession_he: 'מכירת והתקנת דלתות',
    professionRu: 'продажа и установка дверей',
    socials: [
      { platform: 'instagram', url: ig('anton_sababa'),  label: '@anton_sababa' },
      { platform: 'whatsapp',  url: wa('0557717776'),    label: '0557717776' },
      { platform: 'facebook',  url: fb('AntonMikheev'),  label: 'Anton Mikheev' },
    ],
  },
];

// ─── Import ────────────────────────────────────────────────────────────────────

const stmtFindMember = db.prepare("SELECT id, name FROM members WHERE name = ?");
const stmtUpdateProf = db.prepare(
  "UPDATE members SET profession = ?, profession_he = ? WHERE id = ?"
);
const stmtDelSocials = db.prepare("DELETE FROM member_socials WHERE member_id = ?");
const stmtInsSocial  = db.prepare(
  "INSERT INTO member_socials (id, member_id, platform, url, label, sort_order) VALUES (?,?,?,?,?,?)"
);

let updated = 0, notFound = 0;

const doImport = db.transaction(() => {
  for (const m of MEMBERS) {
    const row = stmtFindMember.get(m.dbName);
    if (!row) {
      console.warn(`  [NOT FOUND] "${m.dbName}"`);
      notFound++;
      continue;
    }

    // Update profession fields
    const profRu = m.professionRu ?? row.profession;
    stmtUpdateProf.run(profRu, m.profession_he, row.id);

    // Replace socials
    stmtDelSocials.run(row.id);
    m.socials.forEach((s, i) => {
      stmtInsSocial.run(randomUUID(), row.id, s.platform, s.url, s.label || '', i);
    });

    console.log(`  [OK] ${row.name} — ${m.socials.length} соцсетей`);
    updated++;
  }
});

console.log('\n=== Import socials from PDF ===\n');
doImport();
console.log(`\nГотово: обновлено ${updated} участников, не найдено ${notFound}.`);

db.close();
