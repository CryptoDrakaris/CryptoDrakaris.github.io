// План Абая: неизменная часть плана. Ничего личного здесь нет: задачи, цели и отметки
// живут в Supabase и видны только после входа (RLS). Начальные данные грузит
// scripts/abay-seed.mjs из файла вне репозитория.

export const START = '2026-11-16';
export const DEADLINE = '2026-12-26';
/** Казахстан с 01.03.2024 живёт в одном поясе UTC+5. */
export const TZ_OFFSET_MIN = 5 * 60;

export const CATEGORIES: Record<string, string> = {
  army: 'Военкомат',
  work: 'Работа',
  move: 'Переезд',
  cat: 'Дракарис',
  home: 'Дом',
  food: 'Питание',
  health: 'Здоровье и спорт',
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const HABITS: { key: string; title: string }[] = [
  { key: 'steps_ok', title: 'Шаги не меньше цели' },
  { key: 'food_ok', title: 'Ел по меню: 4 приёма, без сладких напитков, выпечки, фастфуда и еды после 21:00' },
  { key: 'water_ok', title: 'Вода по цели' },
  { key: 'cat_ok', title: 'Дракарис: корм, вода, лоток' },
  { key: 'tidy_ok', title: '10 минут уборки: посуда, мусор, поверхности' },
  { key: 'sleep_ok', title: 'Лёг вовремя' },
  { key: 'workout', title: 'Была тренировка' },
];

export const ROUTINE = [
  'Воскресенье: заказ продуктов в Лавке по списку и готовка №1 (около 1,5 часа)',
  'Среда: готовка №2 (около 1 часа)',
  'Суббота: генеральная уборка, фото комнат',
  'Каждую неделю: проверить корм и наполнитель Дракариса, заказать до четверга',
  'Воскресенье до 21:00: недельный отчёт',
];

/** Поля недельного отчёта в порядке формы. */
export const REPORT_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'army', label: 'Военкомат' },
  { key: 'work', label: 'Работа', hint: 'график, смены, зарплата' },
  { key: 'move', label: 'Переезд' },
  { key: 'cat', label: 'Дракарис' },
  { key: 'home', label: 'Дом', hint: 'уборка, фото комнат' },
  { key: 'food', label: 'Питание', hint: 'заказ, готовка, сколько дней по меню' },
  { key: 'sport', label: 'Спорт', hint: 'тренировки, шаги' },
  { key: 'misses', label: 'Что не получилось' },
  { key: 'help', label: 'Нужна помощь' },
];
