import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutDashboard, Users, Vote, Gift, BarChart2, ChevronRight,
  ChevronLeft, LogOut, Plus, Trash2, Edit2, Check, X, Search,
  Download, Send, Phone, ChevronDown, RefreshCw, Menu, Star,
  Calendar, MessageCircle, UserCheck, Loader2, TrendingUp,
  DollarSign, Handshake, Trophy, AlertCircle, CheckCircle2, Presentation
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import confetti from 'canvas-confetti'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { motion, AnimatePresence } from 'framer-motion'

const cn = (...args: Parameters<typeof clsx>) => twMerge(clsx(...args))
const RED = '#dc2626'

// ─── Types ─────────────────────────────────────────────────────────────────

interface Guest {
  id: string
  firstName: string
  lastName: string
  phone: string
  specialty: string
  invitedBy: string
  meetingDate: string
  paid: number
  waSent: number
  wa_enabled: number
  createdAt: string
}

interface Member {
  id: number
  name: string
  profession: string
  phone: string
  birthday: string
  active: number
  photo?: string
}

interface VotingStatus {
  open: boolean
  voteCount: number
  expected: number
  meetingDate: string
}

interface VoteResult {
  candidateId: number
  candidateName: string
  votes: number
}

interface GuestStat {
  date: string
  total: number
  paid: number
}

interface GroupValueEntry {
  id: number
  meeting_date: string
  member_id: number | null
  member_name: string
  meetings_1on1: number
  referrals: number
  closed_deals: number
  deal_amount: number
}

interface GroupValueTotals {
  total_1on1: number
  total_referrals: number
  total_deals: number
  total_amount: number
}

interface Presentation {
  id: number
  meeting_date: string
  member_name: string
  change_description: string
  notes: string
  status: string
}

type Section =
  | 'dashboard'
  | 'guests'
  | 'members'
  | 'voting'
  | 'birthdays'
  | 'group-value'
  | 'presentations'

// ─── API helpers ────────────────────────────────────────────────────────────

async function api(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('admin_token')
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers || {}),
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('admin_token')
    window.location.reload()
  }
  return res
}

// ─── Login Screen ───────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (res.ok && data.token) {
        localStorage.setItem('admin_token', data.token)
        onLogin()
      } else {
        setError(data.error || 'Неверный пароль')
      }
    } catch {
      setError('Ошибка соединения')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="font-black text-3xl tracking-wider" style={{ color: RED }}>BNI</span>
          <p className="text-xs font-semibold text-gray-400 tracking-widest uppercase mt-1">SYNERGY ADMIN</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            autoFocus
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: RED }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard',    label: 'Дашборд',       icon: <LayoutDashboard size={18} /> },
  { id: 'guests',       label: 'Гости',          icon: <Users size={18} /> },
  { id: 'members',      label: 'Участники',      icon: <UserCheck size={18} /> },
  { id: 'voting',       label: 'Голосование',    icon: <Vote size={18} /> },
  { id: 'birthdays',    label: 'Дни рождения',   icon: <Gift size={18} /> },
  { id: 'group-value',  label: 'Group Value',    icon: <TrendingUp size={18} /> },
  { id: 'presentations',label: 'Презентации',    icon: <Presentation size={18} /> },
]

function Sidebar({
  section,
  collapsed,
  onNavigate,
  onCollapse,
  onLogout,
}: {
  section: Section
  collapsed: boolean
  onNavigate: (s: Section) => void
  onCollapse: () => void
  onLogout: () => void
}) {
  return (
    <div
      className={cn(
        'h-screen bg-gray-900 text-white flex flex-col fixed left-0 top-0 z-50 transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Header */}
      <div className="px-4 py-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        {!collapsed && (
          <div>
            <span className="font-black text-xl tracking-wider" style={{ color: RED }}>BNI</span>
            <p className="text-[10px] font-semibold text-white/40 tracking-widest uppercase mt-0.5">SYNERGY</p>
          </div>
        )}
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors ml-auto"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all',
              section === item.id
                ? 'text-white'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            )}
          >
            <div
              className={cn(
                'flex-shrink-0 p-1.5 rounded-lg transition-colors',
                section === item.id ? 'text-white' : ''
              )}
              style={section === item.id ? { background: RED } : {}}
            >
              {item.icon}
            </div>
            {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 p-3 border-t border-white/10">
        <button
          onClick={onLogout}
          title={collapsed ? 'Выйти' : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
        >
          <LogOut size={16} className="flex-shrink-0" />
          {!collapsed && <span>Выйти</span>}
        </button>
      </div>
    </div>
  )
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

function Dashboard() {
  const [stats, setStats] = useState<GuestStat[]>([])
  const [votingStatus, setVotingStatus] = useState<VotingStatus | null>(null)
  const [membersCount, setMembersCount] = useState(0)
  const [guestCount, setGuestCount] = useState({ count: 0, date: '' })
  const [totals, setTotals] = useState<GroupValueTotals | null>(null)
  const [winners, setWinners] = useState<{ date: string | null; winners: VoteResult[] }>({ date: null, winners: [] })
  const [birthdays, setBirthdays] = useState<(Member & { daysUntil: number })[]>([])

  useEffect(() => {
    Promise.all([
      api('/api/guests/stats').then(r => r.json()),
      api('/api/voting/status').then(r => r.json()),
      api('/api/members/count').then(r => r.json()),
      api('/api/guests/active-count').then(r => r.json()),
      api('/api/group-value/totals').then(r => r.json()),
      api('/api/voting/winners').then(r => r.json()),
      api('/api/birthdays/upcoming?days=14').then(r => r.json()),
    ]).then(([s, vs, mc, gc, t, w, b]) => {
      setStats(s)
      setVotingStatus(vs)
      setMembersCount(mc.count)
      setGuestCount(gc)
      setTotals(t)
      setWinners(w)
      setBirthdays(b)
    })
  }, [])

  const chartData = stats.map(s => ({
    name: s.date.slice(0, 5),
    Гости: s.total,
    Оплачено: s.paid,
  }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Участников', value: membersCount, icon: <UserCheck size={20} />, color: 'bg-blue-50 text-blue-600' },
          { label: 'Гостей (встреча)', value: guestCount.count, icon: <Users size={20} />, color: 'bg-green-50 text-green-600' },
          { label: '1-on-1 встречи', value: totals?.total_1on1 ?? 0, icon: <Handshake size={20} />, color: 'bg-purple-50 text-purple-600' },
          { label: 'Сделок закрыто', value: totals?.total_deals ?? 0, icon: <TrendingUp size={20} />, color: 'bg-amber-50 text-amber-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className={cn('inline-flex p-2.5 rounded-xl mb-3', card.color)}>
              {card.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Гости по встречам</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="Гости" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Оплачено" fill={RED} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Voting status */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Голосование</h2>
          {votingStatus && (
            <div className="space-y-3">
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium',
                votingStatus.open ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
              )}>
                <div className={cn('w-2 h-2 rounded-full', votingStatus.open ? 'bg-green-500' : 'bg-gray-400')} />
                {votingStatus.open ? 'Открыто' : 'Закрыто'}
              </div>
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-900">{votingStatus.voteCount}</span> / {votingStatus.expected} голосов
              </div>
              {winners.winners.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Лидеры</p>
                  {winners.winners.slice(0, 3).map((w, i) => (
                    <div key={w.candidateId} className="flex items-center gap-2 text-sm">
                      <span className={cn('font-bold text-xs w-5', i === 0 ? 'text-yellow-500' : 'text-gray-400')}>
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-gray-700">{w.candidateName}</span>
                      <span className="font-semibold text-gray-900">{w.votes}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Birthdays */}
      {birthdays.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Дни рождения (14 дней)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {birthdays.map(m => (
              <BirthdayCard key={m.id} member={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BirthdayCard({ member }: { member: Member & { daysUntil: number } }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const wish = async () => {
    if (!member.phone) return
    setSending(true)
    try {
      await api(`/api/members/${member.id}/wish-birthday`, { method: 'POST' })
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  // Build WhatsApp link
  const waPhone = member.phone.replace(/\D/g, '').replace(/^0/, '972')

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
      <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 font-bold text-sm flex-shrink-0">
        🎂
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{member.name}</p>
        <p className="text-xs text-amber-600">
          {member.daysUntil === 0 ? 'Сегодня! 🎉' : `Через ${member.daysUntil} дн.`}
        </p>
      </div>
      <div className="flex gap-1">
        {member.phone && (
          <a
            href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`🎂 С Днём рождения, ${member.name.split(' ')[0]}!\n\nВся группа BNI SYNERGY поздравляет! 🎉`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
            title="Поздравить в WA"
          >
            <MessageCircle size={14} />
          </a>
        )}
        <button
          onClick={wish}
          disabled={sending || sent || !member.phone}
          className="p-1.5 rounded-lg bg-white text-amber-600 hover:bg-amber-100 disabled:opacity-40 transition-colors"
          title="Авто-поздравление"
        >
          {sent ? <Check size={14} /> : sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

// ─── Guests Section ─────────────────────────────────────────────────────────

function GuestsSection() {
  const [meetings, setMeetings] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [guests, setGuests] = useState<Guest[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [nextMeeting, setNextMeeting] = useState('')

  const loadMeetings = useCallback(async () => {
    const [m, s] = await Promise.all([
      api('/api/meetings').then(r => r.json()),
      api('/api/settings/next-meeting').then(r => r.json()),
    ])
    setMeetings(m)
    setNextMeeting(s.date || '')
    if (!selectedDate && m.length) setSelectedDate(m[0])
  }, [selectedDate])

  useEffect(() => { loadMeetings() }, [loadMeetings])

  useEffect(() => {
    if (!selectedDate) return
    setLoading(true)
    api(`/api/guests?date=${selectedDate}`)
      .then(r => r.json())
      .then(g => { setGuests(g); setLoading(false) })
  }, [selectedDate])

  const filtered = guests.filter(g =>
    `${g.firstName} ${g.lastName} ${g.phone} ${g.specialty}`.toLowerCase().includes(search.toLowerCase())
  )

  const markPaid = async (id: string) => {
    await api(`/api/guests/${id}/paid`, { method: 'PUT' })
    setGuests(gs => gs.map(g => g.id === id ? { ...g, paid: 1 } : g))
  }

  const toggleWa = async (id: string) => {
    const r = await api(`/api/guests/${id}/wa-toggle`, { method: 'PATCH' })
    const { wa_enabled } = await r.json()
    setGuests(gs => gs.map(g => g.id === id ? { ...g, wa_enabled } : g))
  }

  const paidCount = guests.filter(g => g.paid).length
  const totalCount = guests.length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Гости</h1>
        <div className="flex items-center gap-2">
          <a href="/api/pdf/list" target="_blank" className="btn-outline text-xs px-3 py-2 flex items-center gap-1.5">
            <Download size={14} /> PDF список
          </a>
          <a href="/api/pdf/badges" target="_blank" className="btn-outline text-xs px-3 py-2 flex items-center gap-1.5">
            <Download size={14} /> Бейджи
          </a>
        </div>
      </div>

      {/* Meeting selector */}
      <div className="flex gap-2 flex-wrap">
        {meetings.map(d => (
          <button
            key={d}
            onClick={() => setSelectedDate(d)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
              selectedDate === d
                ? 'text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            )}
            style={selectedDate === d ? { background: RED } : {}}
          >
            {d}
            {d === nextMeeting && <span className="ml-1 text-xs opacity-70">(след.)</span>}
          </button>
        ))}
      </div>

      {selectedDate && (
        <div className="flex gap-3 items-center text-sm text-gray-600">
          <span className="font-medium text-gray-900">{totalCount}</span> гостей
          <span>·</span>
          <span className="text-green-600 font-medium">{paidCount}</span> оплатили
          <span>·</span>
          <span className="text-gray-400">{totalCount - paidCount}</span> не оплатили
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск гостей..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 bg-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {search ? 'Ничего не найдено' : 'Гостей нет'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Имя</th>
                <th className="px-4 py-3 font-medium">Телефон</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Профессия</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Кто пригласил</th>
                <th className="px-4 py-3 font-medium">WA</th>
                <th className="px-4 py-3 font-medium">Оплата</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {g.firstName} {g.lastName}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <a
                      href={`https://wa.me/${g.phone.replace(/\D/g,'').replace(/^0/,'972')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-green-600 flex items-center gap-1"
                    >
                      <Phone size={12} />
                      {g.phone}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{g.specialty}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{g.invitedBy}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleWa(g.id)}
                      className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium transition-colors',
                        g.wa_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      {g.wa_enabled ? 'Вкл' : 'Выкл'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {g.paid ? (
                      <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                        <CheckCircle2 size={14} /> Оплачено
                      </span>
                    ) : (
                      <button
                        onClick={() => markPaid(g.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
                      >
                        Отметить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Members Section ─────────────────────────────────────────────────────────

function MembersSection() {
  const [members, setMembers] = useState<Member[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Member | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inviteModal, setInviteModal] = useState<Member | null>(null)
  const [nextMeeting, setNextMeeting] = useState('')
  const [editForm, setEditForm] = useState({ name: '', profession: '', phone: '', birthday: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api('/api/members').then(r => r.json()),
      api('/api/settings/next-meeting').then(r => r.json()),
    ]).then(([m, s]) => {
      setMembers(m)
      setNextMeeting(s.date || '')
      setLoading(false)
    })
  }, [])

  const startEdit = (m: Member) => {
    setEditing(m)
    setEditForm({ name: m.name, profession: m.profession, phone: m.phone, birthday: m.birthday })
  }

  const startAdd = () => {
    setAdding(true)
    setEditForm({ name: '', profession: '', phone: '', birthday: '' })
  }

  const saveEdit = async () => {
    setSaving(true)
    if (adding) {
      const r = await api('/api/members', { method: 'POST', body: JSON.stringify(editForm) })
      const { id } = await r.json()
      setMembers(ms => [...ms, { ...editForm, id, active: 1 }])
      setAdding(false)
    } else if (editing) {
      await api(`/api/members/${editing.id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      setMembers(ms => ms.map(m => m.id === editing.id ? { ...m, ...editForm } : m))
      setEditing(null)
    }
    setSaving(false)
  }

  const toggleActive = async (m: Member) => {
    if (m.active) {
      await api(`/api/members/${m.id}`, { method: 'DELETE' })
      setMembers(ms => ms.map(x => x.id === m.id ? { ...x, active: 0 } : x))
    } else {
      await api(`/api/members/${m.id}/activate`, { method: 'PATCH' })
      setMembers(ms => ms.map(x => x.id === m.id ? { ...x, active: 1 } : x))
    }
  }

  const displayed = members
    .filter(m => showInactive || m.active)
    .filter(m => `${m.name} ${m.profession}`.toLowerCase().includes(search.toLowerCase()))

  const isEditing = editing !== null || adding
  const cancelEdit = () => { setEditing(null); setAdding(false) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Участники</h1>
        <div className="flex items-center gap-2">
          <a
            href="/api/pdf/members"
            target="_blank"
            className="btn-outline text-xs px-3 py-2 flex items-center gap-1.5"
          >
            <Download size={14} /> PDF каталог
          </a>
          <button
            onClick={startAdd}
            className="text-xs px-3 py-2 rounded-xl text-white flex items-center gap-1.5"
            style={{ background: RED }}
          >
            <Plus size={14} /> Добавить
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 bg-white"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Показать архив
        </label>
      </div>

      {/* Add/Edit form */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-red-100"
          >
            <h3 className="font-semibold text-gray-800 mb-4">
              {adding ? 'Новый участник' : 'Редактировать'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: 'name', label: 'Имя *', placeholder: 'Иван Иванов' },
                { key: 'profession', label: 'Профессия', placeholder: 'Программист' },
                { key: 'phone', label: 'Телефон', placeholder: '0501234567' },
                { key: 'birthday', label: 'День рождения (ДД/ММ)', placeholder: '15/06' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{f.label}</label>
                  <input
                    value={editForm[f.key as keyof typeof editForm]}
                    onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={saveEdit}
                disabled={saving || !editForm.name}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: RED }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={cancelEdit} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">
                Отмена
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Members grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map(m => (
            <div
              key={m.id}
              className={cn(
                'bg-white rounded-2xl p-4 shadow-sm transition-all',
                !m.active && 'opacity-50'
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ background: RED }}>
                  {m.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{m.name}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{m.profession}</p>
                  {m.phone && (
                    <a
                      href={`https://wa.me/${m.phone.replace(/\D/g,'').replace(/^0/,'972')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-green-600 hover:underline mt-0.5 flex items-center gap-1"
                    >
                      <Phone size={11} /> {m.phone}
                    </a>
                  )}
                  {m.birthday && (
                    <p className="text-xs text-amber-500 mt-0.5">🎂 {m.birthday}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => startEdit(m)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setInviteModal(m)}
                    className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600"
                    title="Пригласить гостя"
                  >
                    <UserCheck size={14} />
                  </button>
                  <button
                    onClick={() => toggleActive(m)}
                    className={cn('p-1.5 rounded-lg text-gray-400 transition-colors',
                      m.active ? 'hover:bg-red-50 hover:text-red-500' : 'hover:bg-green-50 hover:text-green-500')}
                  >
                    {m.active ? <Trash2 size={14} /> : <RefreshCw size={14} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite link modal */}
      <AnimatePresence>
        {inviteModal && (
          <InviteLinkModal
            member={inviteModal}
            nextMeeting={nextMeeting}
            onClose={() => setInviteModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function InviteLinkModal({ member, nextMeeting, onClose }: { member: Member; nextMeeting: string; onClose: () => void }) {
  const [type, setType] = useState<'guest' | 'substitute'>('guest')
  const encoded = encodeURIComponent(member.name.split(' ')[0])
  const link = `https://bnisynergy.biz/guest?ref=${encoded}&date=${nextMeeting}&type=${type === 'substitute' ? 'sub' : 'guest'}`

  const copy = () => { navigator.clipboard.writeText(link) }
  const wa = () => window.open(`https://wa.me/?text=${encodeURIComponent(link)}`, '_blank')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-900 mb-4">Ссылка для приглашения</h3>
        <p className="text-sm text-gray-600 mb-4">{member.name} → {nextMeeting}</p>

        <div className="flex gap-2 mb-4">
          {(['guest', 'substitute'] as const).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn('flex-1 py-2 rounded-xl text-sm font-medium transition-all',
                type === t ? 'text-white' : 'bg-gray-100 text-gray-600')}
              style={type === t ? { background: RED } : {}}
            >
              {t === 'guest' ? 'Гость' : 'Замена'}
            </button>
          ))}
        </div>

        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 break-all mb-4">{link}</div>

        <div className="flex gap-2">
          <button onClick={copy} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">
            Копировать
          </button>
          <button
            onClick={wa}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium"
            style={{ background: '#25D366' }}
          >
            WhatsApp
          </button>
          <button onClick={onClose} className="p-2.5 rounded-xl bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Voting Section ──────────────────────────────────────────────────────────

function VotingSection() {
  const [status, setStatus] = useState<VotingStatus | null>(null)
  const [results, setResults] = useState<VoteResult[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      api('/api/voting/status').then(x => x.json()),
      api('/api/voting/results').then(x => x.json()),
    ])
    setStatus(s)
    setResults(r)
  }, [])

  useEffect(() => { load() }, [load])

  const openVoting = async () => {
    setLoading(true)
    await api('/api/voting/open', { method: 'POST' })
    await load()
    setLoading(false)
  }

  const closeVoting = async () => {
    setLoading(true)
    await api('/api/voting/close', { method: 'POST' })
    if (results[0]) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    }
    await load()
    setLoading(false)
  }

  const resetVoting = async () => {
    if (!confirm('Сбросить все голоса?')) return
    setLoading(true)
    await api('/api/voting/reset', { method: 'POST' })
    await load()
    setLoading(false)
  }

  const maxVotes = results[0]?.votes || 1

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Голосование</h1>

      {/* Status card */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold',
            status?.open ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          )}>
            <div className={cn('w-2.5 h-2.5 rounded-full', status?.open ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} />
            {status?.open ? 'Голосование открыто' : 'Голосование закрыто'}
          </div>

          {status && (
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{status.voteCount}</span> / {status.expected} голосов
            </div>
          )}

          <div className="flex gap-2 ml-auto">
            {!status?.open ? (
              <button
                onClick={openVoting}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: RED }}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : 'Открыть голосование'}
              </button>
            ) : (
              <button
                onClick={closeVoting}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-medium disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : 'Закрыть голосование'}
              </button>
            )}
            <button
              onClick={resetVoting}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Результаты</h2>
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={r.candidateId} className="flex items-center gap-3">
                <div className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0"
                  style={i === 0 ? { background: '#FEF3C7', color: '#D97706' } : { background: '#F3F4F6', color: '#6B7280' }}>
                  {i === 0 ? '🏆' : i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800">{r.candidateName}</span>
                    <span className="text-gray-500">{r.votes}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(r.votes / maxVotes) * 100}%`,
                        background: i === 0 ? '#F59E0B' : RED,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Birthdays Section ───────────────────────────────────────────────────────

function BirthdaysSection() {
  const [members, setMembers] = useState<(Member & { daysUntil: number })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/birthdays/upcoming?days=60')
      .then(r => r.json())
      .then(data => { setMembers(data); setLoading(false) })
  }, [])

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Дни рождения</h1>
      <p className="text-sm text-gray-500">Ближайшие 60 дней</p>

      {members.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Нет предстоящих дней рождений</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map(m => <BirthdayCard key={m.id} member={m} />)}
        </div>
      )}
    </div>
  )
}

// ─── Group Value Section ─────────────────────────────────────────────────────

function GroupValueSection() {
  const [entries, setEntries] = useState<GroupValueEntry[]>([])
  const [totals, setTotals] = useState<GroupValueTotals | null>(null)
  const [summary, setSummary] = useState<(GroupValueTotals & { meeting_date: string; member_count: number })[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [loading, setLoading] = useState(true)

  const emptyForm = {
    member_id: 0, member_name: '', meetings_1on1: 0,
    referrals: 0, closed_deals: 0, deal_amount: 0
  }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api('/api/group-value/totals').then(r => r.json()),
      api('/api/group-value/summary').then(r => r.json()),
      api('/api/members?active=true').then(r => r.json()),
    ]).then(([t, s, m]) => {
      setTotals(t)
      setSummary(s)
      setMembers(m)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!selectedDate) { setEntries([]); return }
    api(`/api/group-value?date=${selectedDate}`)
      .then(r => r.json())
      .then(setEntries)
  }, [selectedDate])

  const save = async () => {
    setSaving(true)
    const nextMeeting = (await api('/api/settings/next-meeting').then(r => r.json())).date
    const body = {
      ...form,
      meeting_date: selectedDate || nextMeeting,
      member_id: form.member_id || null,
    }
    if (editingId !== null) {
      await api(`/api/group-value/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
    } else {
      await api('/api/group-value', { method: 'POST', body: JSON.stringify(body) })
    }
    const [updated, t] = await Promise.all([
      api(`/api/group-value?date=${body.meeting_date}`).then(r => r.json()),
      api('/api/group-value/totals').then(r => r.json()),
    ])
    setEntries(updated)
    setTotals(t)
    setEditingId(null)
    setAddingNew(false)
    setForm(emptyForm)
    setSaving(false)
  }

  const del = async (id: number) => {
    await api(`/api/group-value/${id}`, { method: 'DELETE' })
    setEntries(es => es.filter(e => e.id !== id))
    const t = await api('/api/group-value/totals').then(r => r.json())
    setTotals(t)
  }

  const startEdit = (e: GroupValueEntry) => {
    setEditingId(e.id)
    setAddingNew(false)
    setForm({ member_id: e.member_id || 0, member_name: e.member_name, meetings_1on1: e.meetings_1on1, referrals: e.referrals, closed_deals: e.closed_deals, deal_amount: e.deal_amount })
  }

  const dates = summary.map(s => s.meeting_date)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Group Value</h1>

      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '1-on-1', value: totals.total_1on1, icon: <Handshake size={18} />, color: 'bg-blue-50 text-blue-600' },
            { label: 'Рефералы', value: totals.total_referrals, icon: <Users size={18} />, color: 'bg-purple-50 text-purple-600' },
            { label: 'Сделки', value: totals.total_deals, icon: <Trophy size={18} />, color: 'bg-amber-50 text-amber-600' },
            { label: 'Сумма', value: `₪${(totals.total_amount || 0).toLocaleString()}`, icon: <DollarSign size={18} />, color: 'bg-green-50 text-green-600' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className={cn('inline-flex p-2.5 rounded-xl mb-2', c.color)}>{c.icon}</div>
              <p className="text-xl font-bold text-gray-900">{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Date selector */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-sm text-gray-500">Встреча:</span>
        {dates.map(d => (
          <button
            key={d}
            onClick={() => setSelectedDate(d)}
            className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-all',
              selectedDate === d ? 'text-white' : 'bg-white text-gray-600 border border-gray-200')}
            style={selectedDate === d ? { background: RED } : {}}
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => { setAddingNew(true); setEditingId(null) }}
          className="px-3 py-1.5 rounded-full text-sm font-medium text-white flex items-center gap-1"
          style={{ background: RED }}
        >
          <Plus size={14} /> Добавить
        </button>
      </div>

      {/* Add/Edit form */}
      <AnimatePresence>
        {(addingNew || editingId !== null) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-red-100"
          >
            <h3 className="font-semibold text-gray-800 mb-4">{editingId !== null ? 'Редактировать' : 'Новая запись'}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-3">
                <label className="text-xs font-medium text-gray-500 block mb-1">Участник</label>
                <select
                  value={form.member_id}
                  onChange={e => {
                    const m = members.find(x => x.id === +e.target.value)
                    setForm(f => ({ ...f, member_id: +e.target.value, member_name: m?.name || f.member_name }))
                  }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                >
                  <option value={0}>Выберите участника</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {[
                { key: 'meetings_1on1', label: '1-on-1', type: 'number' },
                { key: 'referrals', label: 'Рефералы', type: 'number' },
                { key: 'closed_deals', label: 'Сделки', type: 'number' },
                { key: 'deal_amount', label: 'Сумма (₪)', type: 'number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={form[f.key as keyof typeof form]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: +e.target.value }))}
                    min={0}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={save}
                disabled={saving || !form.member_name}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: RED }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                onClick={() => { setEditingId(null); setAddingNew(false); setForm(emptyForm) }}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium"
              >
                Отмена
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      {selectedDate && entries.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Участник</th>
                <th className="px-4 py-3 font-medium text-center">1-on-1</th>
                <th className="px-4 py-3 font-medium text-center">Реф.</th>
                <th className="px-4 py-3 font-medium text-center">Сделки</th>
                <th className="px-4 py-3 font-medium text-right">Сумма</th>
                <th className="px-4 py-3 font-medium w-16" />
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.member_name}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.meetings_1on1}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.referrals}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.closed_deals}</td>
                  <td className="px-4 py-3 text-right text-gray-700 font-medium">₪{e.deal_amount.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => startEdit(e)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><Edit2 size={13} /></button>
                      <button onClick={() => del(e.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Presentations Section ───────────────────────────────────────────────────

function PresentationsSection() {
  const [items, setItems] = useState<Presentation[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Presentation | null>(null)
  const [form, setForm] = useState({ meeting_date: '', member_name: '', change_description: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [nextMeeting, setNextMeeting] = useState('')

  useEffect(() => {
    Promise.all([
      api('/api/presentations').then(r => r.json()),
      api('/api/members?active=true').then(r => r.json()),
      api('/api/settings/next-meeting').then(r => r.json()),
    ]).then(([p, m, s]) => {
      setItems(p)
      setMembers(m)
      setNextMeeting(s.date || '')
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    if (editing) {
      await api(`/api/presentations/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) })
      setItems(ps => ps.map(p => p.id === editing.id ? { ...p, ...form } : p))
      setEditing(null)
    } else {
      const r = await api('/api/presentations', { method: 'POST', body: JSON.stringify(form) })
      const { id } = await r.json()
      setItems(ps => [{ id, ...form, status: 'pending' }, ...ps])
      setAdding(false)
    }
    setSaving(false)
  }

  const toggle = async (id: number) => {
    const r = await api(`/api/presentations/${id}/toggle`, { method: 'PATCH' })
    const { status } = await r.json()
    setItems(ps => ps.map(p => p.id === id ? { ...p, status } : p))
  }

  const del = async (id: number) => {
    await api(`/api/presentations/${id}`, { method: 'DELETE' })
    setItems(ps => ps.filter(p => p.id !== id))
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setForm({ meeting_date: nextMeeting, member_name: '', change_description: '', notes: '' })
  }

  const startEdit = (p: Presentation) => {
    setEditing(p)
    setAdding(false)
    setForm({ meeting_date: p.meeting_date, member_name: p.member_name, change_description: p.change_description, notes: p.notes })
  }

  const isEditing = adding || editing !== null

  // Group by date
  const grouped = items.reduce<Record<string, Presentation[]>>((acc, p) => {
    ;(acc[p.meeting_date] = acc[p.meeting_date] || []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Презентации</h1>
        <button onClick={startAdd} className="text-sm px-4 py-2 rounded-xl text-white flex items-center gap-2" style={{ background: RED }}>
          <Plus size={14} /> Добавить
        </button>
      </div>

      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-red-100"
          >
            <h3 className="font-semibold text-gray-800 mb-4">{editing ? 'Редактировать' : 'Новая запись'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Дата встречи</label>
                <input
                  value={form.meeting_date}
                  onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}
                  placeholder="09/03"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Участник</label>
                <select
                  value={form.member_name}
                  onChange={e => setForm(f => ({ ...f, member_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                >
                  <option value="">Выберите участника</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">Что представляет</label>
                <input
                  value={form.change_description}
                  onChange={e => setForm(f => ({ ...f, change_description: e.target.value }))}
                  placeholder="Новый продукт / услуга..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">Заметки</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={save}
                disabled={saving || !form.member_name || !form.change_description}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: RED }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => { setAdding(false); setEditing(null) }} className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">
                Отмена
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
      ) : (
        Object.entries(grouped).map(([date, pItems]) => (
          <div key={date} className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{date}</h2>
            {pItems.map(p => (
              <div key={p.id} className={cn('bg-white rounded-xl p-4 shadow-sm flex items-start gap-3', p.status === 'done' && 'opacity-60')}>
                <button
                  onClick={() => toggle(p.id)}
                  className={cn('mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors',
                    p.status === 'done' ? 'border-green-500 bg-green-500' : 'border-gray-300')}
                >
                  {p.status === 'done' && <Check size={11} className="text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-gray-900 text-sm">{p.member_name}</span>
                    <span className="text-xs text-gray-500">· {p.change_description}</span>
                  </div>
                  {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(p)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><Edit2 size={13} /></button>
                  <button onClick={() => del(p.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('admin_token'))
  const [section, setSection] = useState<Section>('dashboard')
  const [collapsed, setCollapsed] = useState(false)

  const logout = () => {
    localStorage.removeItem('admin_token')
    setAuthed(false)
  }

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  const SECTIONS: Record<Section, React.ReactNode> = {
    dashboard:     <Dashboard />,
    guests:        <GuestsSection />,
    members:       <MembersSection />,
    voting:        <VotingSection />,
    birthdays:     <BirthdaysSection />,
    'group-value': <GroupValueSection />,
    presentations: <PresentationsSection />,
  }

  const sidebarW = collapsed ? 64 : 240

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar
        section={section}
        collapsed={collapsed}
        onNavigate={setSection}
        onCollapse={() => setCollapsed(c => !c)}
        onLogout={logout}
      />
      <main
        className="transition-all duration-300 min-h-screen"
        style={{ paddingLeft: sidebarW }}
      >
        <div className="p-6 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {SECTIONS[section]}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
