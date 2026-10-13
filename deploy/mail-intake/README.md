# Приём писем BNI Connect (guests@in.bnisynergy.biz)

Схема: Gmail пересылает письма `bni.notifications@bniconnectglobal.com` на `guests@in.bnisynergy.biz` →
Postfix (только приём) → pipe `/usr/local/bin/bni-mail-intake` → `POST 127.0.0.1:3000/internal/mail-intake`
→ проверка From + темы + DKIM → гость в БД → WhatsApp-приглашение.

## Порядок запуска
1. Задеплоить код (pull, `npm install`, `pm2 restart bni-synergy`). Миграция БД создаёт колонки и таблицу `mail_intake` сама.
2. Проверить скрипт и запустить его от root:
   `bash /var/www/bni-synergy/deploy/mail-intake/setup-mail-intake.sh`
   Скрипт ставит Postfix, добавляет `MAIL_INTAKE_SECRET` в `.env` (если его нет), настраивает приём только для
   `guests@in.bnisynergy.biz` и в конце сам проверяет, что это не open relay (3 SMTP-теста). Если хоть один FAIL, порт 25 не открывать.
3. `pm2 restart bni-synergy` (приложение читает `.env` при старте).
4. Порт 25: на VPS `ufw` сейчас inactive (локально ничего открывать не нужно). Если включите ufw: `ufw allow 25/tcp`.
   Проверьте облачный фаервол Kamatera: входящий TCP 25 должен быть разрешён.
5. Gmail: Настройки → Пересылка → «Добавить адрес» `guests@in.bnisynergy.biz`. Gmail пришлёт письмо подтверждения: код и ссылка
   появятся в логе: `pm2 logs bni-synergy --lines 50 --nostream | grep MailIntake`. Подтвердить, затем создать фильтр
   `from:bni.notifications@bniconnectglobal.com subject:"הודעה על רישום אורח"` → «Переслать на guests@in.bnisynergy.biz».
6. Проверить DKIM на настоящих письмах вручную (в репозиторий `.eml` не коммитить):
   `node scripts/check-eml.js /var/mail-intake/ГГГГ-ММ-ДД/файл.eml` → `Verdict: bni`.

## Где что лежит
- Сырые письма: `/var/mail-intake/ГГГГ-ММ-ДД/`, отклонённые (From BNI, но тема/DKIM неверны): `/var/mail-intake/rejected/ГГГГ-ММ-ДД/`.
  Права 700, чистка старше 30 дней: `/etc/cron.daily/bni-mail-intake-clean`.
- Письма не от BNI (например, подтверждение Gmail) только сохраняются; в лог pm2 пишутся тема, отправитель и строки с кодом/ссылкой.
- Статусы обработки: таблица `mail_intake` (`created`, `merged`, `duplicate`, `ignored`, `rejected`, `unparsed`, `error`).
- Дополнительно (необязательно): `deploy/mail-intake/nginx-internal-block.conf` закрывает `/internal/` на уровне nginx.
  Приложение и так отвергает запросы, пришедшие через прокси (заголовок X-Real-IP) или не с 127.0.0.1.

## Откат
`systemctl disable --now postfix`; бэкапы конфигов: `/etc/postfix/main.cf.bak.*`, `master.cf.bak.*`.
