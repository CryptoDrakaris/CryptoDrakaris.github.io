# Как поднять проект на компьютере

Сайт: https://cryptodrakaris.github.io/
Репозиторий: https://github.com/CryptoDrakaris/CryptoDrakaris.github.io

Компьютеры – Mac. На каждом – своя рабочая копия `~/Projects/drakaris-site`, между ними проект переносится через GitHub (`git pull` / `git push`).

## Что нужно установить

| Программа | Версия | Где взять |
|---|---|---|
| Node.js | 22 или новее (проект собран на 22.23) | Homebrew, см. ниже |
| Git | любая свежая | входит в Command Line Tools: `xcode-select --install` |

Больше ничего не нужно: ни ключей API, ни платных сервисов, ни Python.

Node через Homebrew (https://brew.sh), проверено на Apple Silicon:

```bash
brew install node@22
brew link --force --overwrite node@22
node -v && npm -v && git --version
```

`node@22` по умолчанию не попадает в PATH, `brew link --force` это исправляет: `node -v` должен показать `v22.x`.

## Рабочая копия

```bash
mkdir -p ~/Projects && cd ~/Projects
git clone https://github.com/CryptoDrakaris/CryptoDrakaris.github.io.git drakaris-site
cd drakaris-site
npm ci
npm run dev
```

Откройте http://localhost:4321 – сайт работает локально. При первом `git push` откроется окно входа в GitHub, дальше компьютер запомнит вход.

Коммиты подписываются только Drakaris – один раз в каждой новой копии:

```bash
git config user.name Drakaris
git config user.email 321777324+CryptoDrakaris@users.noreply.github.com
```

### Почему не в облачной папке

Облачные диски на Mac хранят файлы «по требованию»: на диске лежит заглушка (в `ls -lO` – пометка `dataless`), содержимое скачивается при первом обращении. С тысячами мелких файлов `node_modules` и с папкой `.git` это не работает: сборка и `git status` зависают без вывода, а синхронизация теряет файлы. Поэтому проект живёт в `~/Projects`. Облачная копия – только для чтения и для того, чего нет в git (`data/originals`).

## Работа на нескольких компьютерах

Главное правило: **основное хранилище – репозиторий на GitHub.**

- Перед работой: `git pull`
- После работы: `git add -A && git commit -m "..." && git push`
- Не правьте проект на двух компьютерах одновременно, иначе при `git pull` будут конфликты.

### Если история на GitHub переписана

Историю переписывают, когда из старых коммитов нужно убрать лишнее (последний раз – 2026-11-12). Хеши коммитов после этого другие, и обычный `git pull` на старом клоне выдаёт ошибку или пытается слить старую историю с новой. **Не сливать и не делать `git push --force` со старого клона:** старые коммиты вернутся на GitHub.

Порядок для каждого компьютера со старым клоном. Оригиналы `data/originals`, `node_modules` и прочие файлы вне git не трогаются.

1. Проверить, нет ли своей неотправленной работы:

   ```bash
   cd ~/Projects/drakaris-site
   git status --short
   git log --oneline origin/main..HEAD
   ```

   Если обе команды ничего не выводят – сразу к шагу 2. Иначе сохранить свои изменения в патчи и отложить правки:

   ```bash
   git format-patch origin/main..HEAD -o ~/Desktop/drakaris-patches
   git stash push -u -m "до переписанной истории"
   ```

2. Перейти на новую историю:

   ```bash
   git fetch --prune origin
   git checkout main
   git reset --hard origin/main
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep -vx main); do git branch -D "$b"; done
   npm ci
   ```

   В шаге 1 была работа? Вернуть её: `git am ~/Desktop/drakaris-patches/*.patch` (коммиты), затем `git stash pop` (неотправленные правки). Конфликт – решить, `git add` и `git am --continue`.

3. Удалить старую историю с диска – только после шага 2, иначе отложенные правки удержат её:

   ```bash
   git stash list          # должно быть пусто
   git update-ref -d ORIG_HEAD   # после reset указывает на старый коммит
   git reflog expire --expire=now --all
   git gc --prune=now
   ```

4. Проверить: `git status -sb` показывает `## main...origin/main` (с `ahead`, если вернули свои коммиты), а `git log --oneline -1 origin/main` – тот же коммит, что на главной странице репозитория на GitHub.

Вместо шагов 1–3 можно клон удалить и сделать заново (раздел «Рабочая копия»), но тогда `data/originals` и `node_modules` нужно перенести или восстановить (`npm ci`, `npm run fetch`).

## Что в репозитории, а что восстанавливается

| Папка | Размер | Где |
|---|---|---|
| `src`, `scripts`, `data/collection.json`, `data/derived.json`, `public/derived` | ~50 МБ | в репозитории, это сам проект |
| `node_modules` | ~236 МБ | восстанавливается командой `npm ci` на каждом компьютере |
| `dist` | ~56 МБ | результат сборки, `npm run build` |
| `data/originals` | ~335 МБ | оригиналы NFT, `npm run fetch` |

Сайт собирается **без** оригиналов: превью уже лежат в репозитории, поэтому `npm run build` работает сразу после `npm ci`.

## Команды

```bash
npm run dev      # локальный просмотр: http://localhost:4321
npm run build    # собрать сайт в папку dist
npm run fetch    # перечитать кошелёк и скачать новые оригиналы (10-20 минут)
npm run derive   # сделать превью и акцентные цвета из оригиналов
npm run archive  # личный архив: оригиналы со всех сетей на диск, на сайт не попадают
```

Проверка доступности перед публикацией (скил `design-audit` – приватный репозиторий `CryptoDrakaris/design-audit`, клон в `~/Projects/design-audit`; зависимости `axe-core` и `jsdom` ставятся вместе с сайтом через `npm ci`):

```bash
node ~/Projects/design-audit/scripts/axe-static.mjs dist --limit 600
```

## Личный архив по всем сетям

`npm run archive` скачивает оригиналы NFT из Ethereum, Base, Polygon, Arbitrum и Optimism в `data/originals` и пишет опись в `data/archive.json`. Сайт от этого не меняется: в нём остаются только коллекции Ethereum.

```bash
npm run archive -- --dry            # показать, что пройдёт фильтр спама, ничего не скачивая
npm run archive -- --chain polygon  # только одна сеть
```

Спам отсеивается автоматически (суммы в названии, домены-однодневки, подделки под известные коллекции). Если что-то отфильтровалось зря или наоборот – контракт вписывается в `ARCHIVE_ALLOW` или `ARCHIVE_DENY` в `scripts/config.mjs`.

Файлы архива не попадают в репозиторий: это десятки гигабайт. На другом компьютере архив восстанавливается той же командой.

## Как обновить сайт после покупки новых NFT

```bash
npm run fetch && npm run derive && npm run build
git add -A && git commit -m "Обновить коллекцию" && git push
```

После `git push` GitHub сам пересоберёт и опубликует сайт за пару минут. Следить за сборкой: вкладка **Actions** в репозитории.

## Если что-то не работает

| Симптом | Что делать |
|---|---|
| `Cannot find package 'astro'` или похожее | `npm ci` |
| `node: command not found` после `brew install node@22` | `brew link --force --overwrite node@22` |
| `npm run build` или `git status` висят без вывода | вы в облачной папке, работайте в `~/Projects/drakaris-site` |
| `sh: .../node_modules/.bin/astro: Permission denied` | `node_modules` скопирована с другого компьютера: удалить её и выполнить `npm ci` |
| Порт 4321 занят | `npm run dev -- --port 4322` |
| `npm run fetch` ругается на 429 и часть картинок не скачалась | публичные шлюзы IPFS ограничивают частоту. Повторить позже, скрипт докачивает только недостающее |
| Сайт собрался, но картинок нет | `npm run derive` |
| `git pull` сообщает о конфликте | проект правили на двух компьютерах сразу: `git status`, решить конфликт в указанных файлах, затем `git add` и `git commit` |

## Что ещё лежит в папке

- `CLAUDE.md` – все решения по проекту: структура, темы, каноны брендов, правила сбора коллекции. Клод читает этот файл автоматически.
- `README.md` – краткое описание и порядок публикации.
- `.github/workflows/deploy.yml` – автоматическая публикация на GitHub Pages.
