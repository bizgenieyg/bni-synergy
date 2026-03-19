import React, { useState, useEffect, useCallback, useRef } from 'react'
import './i18n'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Users, Vote, ChevronRight, ChevronLeft, LogOut,
  Plus, Trash2, Edit2, Check, X, Search, Download, Send, Phone,
  RefreshCw, MessageCircle, UserCheck, Loader2, TrendingUp,
  DollarSign, Handshake, Trophy, CheckCircle2, Presentation,
  Instagram, Linkedin, Facebook, Globe, Upload, Camera, MessageSquare, Calendar
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
  name: string
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

interface MemberSocial {
  platform: string
  url: string
  label?: string
}

interface MeetingStatEntry {
  id: number
  meeting_date: string
  meetings_1on1: number
  referrals: number
  closed_deals: number
  deal_amount: number
  created_at: string
}

interface StatTotals {
  total_1on1: number
  total_referrals: number
  total_deals: number
  total_amount: number
}

interface PendingRow {
  localId: number
  meetings_1on1: number
  referrals: number
  closed_deals: number
  deal_amount: number
}

interface VoteWinner {
  date: string
  winner_name: string
  votes: number
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

interface Presentation {
  id: number
  meeting_date: string
  member_name: string
  change_description: string
  notes: string
  status: string
}

type Section = 'dashboard' | 'guests' | 'members' | 'voting' | 'group-value' | 'presentations'
type Period = 'week' | 'month' | 'quarter' | 'all'

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

function waPhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^0/, '972')
}

// ─── Login ──────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (res.ok && data.token) { localStorage.setItem('admin_token', data.token); onLogin() }
      else setError(data.error || t('login.wrongPassword'))
    } catch { setError(t('login.connectionError')) }
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
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t('login.password')} autoFocus
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading || !password}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: RED }}>
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

// ─── Language Switcher ───────────────────────────────────────────────────────

function LangSwitcher() {
  const { i18n } = useTranslation()
  const LANGS = [
    { code: 'en', label: 'EN' },
    { code: 'ru', label: 'RU' },
    { code: 'he', label: 'HE' },
  ]
  const changeLang = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('lang', lang)
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }
  return (
    <div className="flex gap-1">
      {LANGS.map(l => (
        <button key={l.code} onClick={() => changeLang(l.code)}
          className={cn('text-xs px-2.5 py-1 rounded-lg font-medium transition-colors',
            i18n.language === l.code ? 'text-white' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white')}
          style={i18n.language === l.code ? { background: RED } : {}}>
          {l.label}
        </button>
      ))}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ section, collapsed, onNav, onCollapse, onLogout }:
  { section: Section; collapsed: boolean; onNav: (s: Section) => void; onCollapse: () => void; onLogout: () => void }) {
  const { t, i18n } = useTranslation()
  const isRtl = i18n.language === 'he'

  const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard',     label: 'Dashboard',              icon: <LayoutDashboard size={18} /> },
    { id: 'guests',        label: t('nav.guests'),           icon: <Users size={18} /> },
    { id: 'members',       label: t('nav.members'),          icon: <UserCheck size={18} /> },
    { id: 'voting',        label: t('nav.voting'),           icon: <Vote size={18} /> },
    { id: 'group-value',   label: 'Group Value',             icon: <TrendingUp size={18} /> },
    { id: 'presentations', label: t('nav.presentations'),    icon: <Presentation size={18} /> },
  ]

  return (
    <div className={cn('h-screen bg-gray-900 text-white flex flex-col fixed top-0 z-50 transition-all duration-300',
      isRtl ? 'right-0' : 'left-0',
      collapsed ? 'w-16' : 'w-60')}>
      <div className="px-4 py-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        {!collapsed && (
          <div>
            <span className="font-black text-xl tracking-wider" style={{ color: RED }}>BNI</span>
            <p className="text-[10px] font-semibold text-white/40 tracking-widest uppercase mt-0.5">SYNERGY</p>
          </div>
        )}
        <button onClick={onCollapse} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 ml-auto">
          {collapsed
            ? (isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />)
            : (isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)
          }
        </button>
      </div>
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {NAV.map(item => (
          <button key={item.id} onClick={() => onNav(item.id)} title={collapsed ? item.label : undefined}
            className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all',
              section === item.id ? 'text-white' : 'text-white/50 hover:text-white hover:bg-white/5')}>
            <div className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
              style={section === item.id ? { background: RED } : {}}>
              {item.icon}
            </div>
            {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </button>
        ))}
      </nav>
      <div className="flex-shrink-0 p-3 border-t border-white/10 space-y-1">
        <div className={cn('flex items-center px-3 py-2', collapsed ? 'justify-center' : 'gap-3')}>
          <LangSwitcher />
        </div>
        <button onClick={onLogout} title={collapsed ? t('nav.logout') : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 text-sm">
          <LogOut size={16} className="flex-shrink-0" />
          {!collapsed && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </div>
  )
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ member, size = 40 }: { member: Member; size?: number }) {
  if (member.photo) {
    return (
      <img src={`/uploads/${member.photo}`} alt={member.name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, background: RED, fontSize: size * 0.35 }}>
      {member.name.charAt(0)}
    </div>
  )
}

// ─── Social Icons ────────────────────────────────────────────────────────────

function SocialIcons({ socials }: { socials: MemberSocial[] }) {
  const map: Record<string, { icon: React.ReactNode; color: string }> = {
    whatsapp:  { icon: <MessageCircle size={13} />, color: '#25D366' },
    instagram: { icon: <Instagram size={13} />,    color: '#E1306C' },
    linkedin:  { icon: <Linkedin size={13} />,     color: '#0A66C2' },
    facebook:  { icon: <Facebook size={13} />,     color: '#1877F2' },
    website:   { icon: <Globe size={13} />,          color: '#6B7280' },
    telegram:  { icon: <MessageSquare size={13} />, color: '#0088cc' },
  }
  return (
    <div className="flex gap-1">
      {socials.map(s => {
        const def = map[s.platform]
        if (!def) return null
        return (
          <a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer"
            className="p-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: def.color }} title={s.platform}>
            {def.icon}
          </a>
        )
      })}
    </div>
  )
}

// ─── Date Picker ─────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

function DatePickerInput({ value, onChange, placeholder = 'DD/MM' }:
  { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const ref = useRef<HTMLDivElement>(null)

  // Parse "DD/MM" → { day, month0 } (month is 0-based)
  const parsed = value.match(/^(\d{1,2})\/(\d{1,2})$/)
  const selDay   = parsed ? +parsed[1] : null
  const selMonth = parsed ? +parsed[2] - 1 : null

  const handleOpen = () => {
    if (selMonth !== null) setViewMonth(selMonth)
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1) } else setViewMonth(m => m-1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1) } else setViewMonth(m => m+1) }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const offset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7 // Monday=0

  const selectDay = (day: number) => {
    onChange(`${String(day).padStart(2,'0')}/${String(viewMonth+1).padStart(2,'0')}`)
    setOpen(false)
  }

  const today = new Date()

  return (
    <div ref={ref} className="relative">
      <div onClick={handleOpen}
        className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm cursor-pointer bg-white hover:border-gray-300 select-none min-w-[100px]">
        <Calendar size={13} className="text-gray-400 flex-shrink-0" />
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>{value || placeholder}</span>
      </div>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 w-68">
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronLeft size={15} /></button>
            <span className="text-sm font-semibold text-gray-800">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronRight size={15} /></button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const isSel   = selDay === day && selMonth === viewMonth
              const isToday = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear
              return (
                <button key={day} onClick={() => selectDay(day)}
                  className={cn('text-xs rounded-lg py-1.5 w-full transition-colors leading-none',
                    isSel   ? 'text-white font-semibold'
                    : isToday ? 'font-semibold text-gray-900 bg-gray-100'
                    :           'text-gray-600 hover:bg-gray-100')}
                  style={isSel ? { background: RED } : {}}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Member Edit Modal ───────────────────────────────────────────────────────

function MemberModal({ member, onClose, onSaved }:
  { member: Member | null; onClose: () => void; onSaved: (m: Member) => void }) {
  const { t } = useTranslation()
  const isNew = member === null
  const [form, setForm] = useState({
    name: member?.name ?? '',
    profession: member?.profession ?? '',
    phone: member?.phone ?? '',
    birthday: member?.birthday ?? '',
    active: member?.active ?? 1,
  })
  const [socials, setSocials] = useState<MemberSocial[]>([])
  const [addingPlatform, setAddingPlatform] = useState('whatsapp')
  const [addingUrl, setAddingUrl] = useState('')
  const [showAddSocial, setShowAddSocial] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(member?.photo ? `/uploads/${member.photo}` : null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const SOCIAL_PLATFORMS = [
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'website', label: 'Website' },
    { id: 'telegram', label: 'Telegram' },
  ]

  useEffect(() => {
    if (!isNew && member) {
      api(`/api/members/${member.id}/socials`).then(r => r.json()).then(setSocials)
    }
  }, [member, isNew])

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const save = async () => {
    setSaving(true)
    try {
      let savedMember: Member
      if (isNew) {
        const r = await api('/api/members', { method: 'POST', body: JSON.stringify(form) })
        const { id } = await r.json()
        savedMember = { id, ...form }
      } else {
        await api(`/api/members/${member!.id}`, { method: 'PUT', body: JSON.stringify(form) })
        savedMember = { ...member!, ...form }
      }

      // Upload photo if changed
      if (photoFile && savedMember.id) {
        const fd = new FormData()
        fd.append('photo', photoFile)
        const token = localStorage.getItem('admin_token') || ''
        const pr = await fetch(`/api/members/${savedMember.id}/photo`, {
          method: 'POST', body: fd,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const pd = await pr.json()
        if (pd.url) savedMember.photo = pd.url.replace('/uploads/', '')
      }

      // Save socials
      await api(`/api/members/${savedMember.id}/socials`, {
        method: 'PUT',
        body: JSON.stringify({ socials }),
      })

      onSaved(savedMember)
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof typeof form, label: string, placeholder = '') => (
    <div>
      <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
      {key === 'active' ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <div className={cn('w-10 h-6 rounded-full transition-colors relative', form.active ? 'bg-red-500' : 'bg-gray-200')}
            onClick={() => setForm(f => ({ ...f, active: f.active ? 0 : 1 }))}>
            <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', form.active ? 'left-4' : 'left-0.5')} />
          </div>
          <span className="text-sm text-gray-600">{form.active ? t('common.active') : t('common.inactive')}</span>
        </label>
      ) : (
        <input value={form[key] as string}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
      )}
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-gray-900 text-lg">{isNew ? t('memberModal.newTitle') : t('memberModal.editTitle')}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
          </div>

          {/* Photo */}
          <div className="flex items-center gap-4 mb-5">
            <div className="relative">
              {photoPreview
                ? <img src={photoPreview} alt="" className="w-16 h-16 rounded-full object-cover" />
                : <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl" style={{ background: RED }}>
                    {form.name.charAt(0) || '?'}
                  </div>
              }
              <button onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm hover:bg-gray-50">
                <Camera size={12} className="text-gray-600" />
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{t('memberModal.profilePhoto')}</p>
              <button onClick={() => fileRef.current?.click()} className="text-xs text-red-500 hover:underline mt-0.5">
                {photoPreview ? t('memberModal.changePhoto') : t('memberModal.uploadPhoto')}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPhotoChange} className="hidden" />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {field('name', t('memberModal.nameLabel'), t('memberModal.namePlaceholder'))}
            {field('profession', t('memberModal.professionLabel'), t('memberModal.professionPlaceholder'))}
            {field('phone', t('memberModal.phoneLabel'), t('memberModal.phonePlaceholder'))}
            {field('birthday', t('memberModal.birthdayLabel'), t('memberModal.birthdayPlaceholder'))}
            <div className="col-span-2">{field('active', t('memberModal.statusLabel'))}</div>
          </div>

          <div className="border-t border-gray-100 pt-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('memberModal.socialLinks')}</p>
              {!showAddSocial && (
                <button onClick={() => setShowAddSocial(true)}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1">
                  <Plus size={12} /> {t('memberModal.addSocial')}
                </button>
              )}
            </div>
            {socials.length === 0 && !showAddSocial && (
              <p className="text-xs text-gray-400">{t('memberModal.noSocials')}</p>
            )}
            <div className="space-y-2">
              {socials.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 capitalize w-20 flex-shrink-0">{s.platform}</span>
                  <input value={s.url}
                    onChange={e => setSocials(ss => ss.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-red-400" />
                  <button onClick={() => setSocials(ss => ss.filter((_, j) => j !== i))}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            {showAddSocial && (
              <div className="flex items-center gap-2 mt-2">
                <select value={addingPlatform} onChange={e => setAddingPlatform(e.target.value)}
                  className="w-28 border border-gray-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:border-red-400 flex-shrink-0">
                  {SOCIAL_PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input value={addingUrl} onChange={e => setAddingUrl(e.target.value)}
                  placeholder={t('memberModal.urlPlaceholder')}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-red-400" />
                <button onClick={() => {
                  if (addingUrl.trim()) {
                    setSocials(ss => [...ss, { platform: addingPlatform, url: addingUrl.trim() }])
                    setAddingUrl('')
                  }
                  setShowAddSocial(false)
                }} className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex-shrink-0">
                  <Check size={14} />
                </button>
                <button onClick={() => { setShowAddSocial(false); setAddingUrl('') }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.name}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-50"
              style={{ background: RED }}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Invite Guest Modal ──────────────────────────────────────────────────────

function InviteModal({ members, defaultMember, nextMeeting, onClose }:
  { members: Member[]; defaultMember?: Member; nextMeeting: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<number>(defaultMember?.id ?? members[0]?.id ?? 0)
  const [date, setDate] = useState(nextMeeting)
  const [type, setType] = useState<'guest' | 'substitute'>('guest')
  const [phone, setPhone] = useState('')

  const member = members.find(m => m.id === selectedId)
  const encoded = member ? encodeURIComponent(member.name.split(' ')[0]) : ''
  const phoneDigits = phone.replace(/\D/g, '').replace(/^0/, '972')
  const link = member
    ? `https://bnisynergy.biz/guest?ref=${encoded}&date=${date}&type=${type === 'substitute' ? 'sub' : 'guest'}${phoneDigits ? `&phone=${phoneDigits}` : ''}`
    : ''
  const copy = () => link && navigator.clipboard.writeText(link)
  const wa = () => {
    if (!link) return
    const url = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(link)}`
      : `https://wa.me/?text=${encodeURIComponent(link)}`
    window.open(url, '_blank')
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">{t('invite.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">{t('invite.memberLabel')}</label>
            <select value={selectedId} onChange={e => setSelectedId(+e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400">
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">{t('invite.meetingDateLabel')}</label>
            <input value={date} onChange={e => setDate(e.target.value)} placeholder={t('invite.meetingDatePlaceholder')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Телефон гостя <span className="font-normal text-gray-400">(опционально)</span></label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+972 050 000 0000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {(['guest', 'substitute'] as const).map(gtype => (
            <button key={gtype} onClick={() => setType(gtype)}
              className={cn('flex-1 py-2 rounded-xl text-sm font-medium', type === gtype ? 'text-white' : 'bg-gray-100 text-gray-600')}
              style={type === gtype ? { background: RED } : {}}>
              {gtype === 'guest' ? t('invite.guest') : t('invite.substitute')}
            </button>
          ))}
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 break-all mb-4">{link || '—'}</div>
        <div className="flex gap-2">
          <button onClick={copy} disabled={!link} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium disabled:opacity-40">{t('invite.copy')}</button>
          <button onClick={wa} disabled={!link} className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40" style={{ background: '#25D366' }}>{t('invite.whatsapp')}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Birthday mini-card (used in dashboard + members) ───────────────────────

function BirthdayRow({ member }: { member: Member & { daysUntil: number } }) {
  const { t } = useTranslation()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const wish = async () => {
    setSending(true)
    try { await api(`/api/members/${member.id}/wish-birthday`, { method: 'POST' }); setSent(true) }
    finally { setSending(false) }
  }
  const phone = member.phone ? waPhone(member.phone) : ''
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <Avatar member={member} size={36} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{member.name}</p>
        <p className="text-xs text-gray-400">{member.birthday} · <span className={cn(member.daysUntil === 0 ? 'text-amber-500 font-medium' : 'text-gray-400')}>
          {member.daysUntil === 0 ? t('dashboard.today') : t('dashboard.inDays', { n: member.daysUntil })}
        </span></p>
      </div>
      {phone && (
        <a href={`https://wa.me/${phone}?text=${encodeURIComponent(`🎂 Happy Birthday, ${member.name.split(' ')[0]}!\n\nThe entire BNI SYNERGY group congratulates you! 🎉`)}`}
          target="_blank" rel="noopener noreferrer"
          className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 flex-shrink-0" title="Congratulate in WA">
          <MessageCircle size={14} />
        </a>
      )}
      <button onClick={wish} disabled={sending || sent || !phone}
        className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40 flex-shrink-0" title="Auto-send">
        {sent ? <Check size={14} className="text-green-500" /> : sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      </button>
    </div>
  )
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function getNextMonday(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun, 1=Mon, …, 6=Sat
  const daysUntil = day === 1 ? 7 : (8 - day) % 7
  d.setDate(d.getDate() + daysUntil)
  const yy = String(d.getFullYear()).slice(2)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${yy}`
}

function shiftDDMM(ddmm: string, days: number): string {
  const parts = ddmm.split('/')
  if (parts.length < 2) return ddmm
  const [d, m] = parts.map(Number)
  // Parse year: if YY provided use it, otherwise current year
  const yyRaw = parts[2]
  const year = yyRaw
    ? (Number(yyRaw) < 100 ? 2000 + Number(yyRaw) : Number(yyRaw))
    : new Date().getFullYear()
  const date = new Date(year, m - 1, d)
  date.setDate(date.getDate() + days)
  const yy = String(date.getFullYear()).slice(2)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${yy}`
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

function Dashboard({ onInvite, nextMeeting, onNextMeetingChange }: {
  onInvite: () => void
  nextMeeting: string
  onNextMeetingChange: (date: string) => void
}) {
  const { t } = useTranslation()
  const [stats, setStats] = useState<GuestStat[]>([])
  const [votingStatus, setVotingStatus] = useState<VotingStatus | null>(null)
  const [results, setResults] = useState<VoteResult[]>([])
  const [guestCount, setGuestCount] = useState({ count: 0, date: '' })
  const [recentGuests, setRecentGuests] = useState<Guest[]>([])
  const [birthdays, setBirthdays] = useState<(Member & { daysUntil: number })[]>([])
  const [memberCount, setMemberCount] = useState(0)
  const [gvTotal, setGvTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [savingMeeting, setSavingMeeting] = useState(false)

  const saveMeeting = async (date: string) => {
    setSavingMeeting(true)
    try {
      const r = await api('/api/settings/next-meeting', { method: 'PATCH', body: JSON.stringify({ date }) })
      if (r.ok) onNextMeetingChange(date)
    } finally { setSavingMeeting(false) }
  }

  useEffect(() => {
    Promise.all([
      api('/api/guests/stats').then(r => r.json()),
      api('/api/voting/status').then(r => r.json()),
      api('/api/voting/results').then(r => r.json()),
      api('/api/guests/active-count').then(r => r.json()),
      api('/api/birthdays/upcoming?days=14').then(r => r.json()),
      api('/api/members?active=true').then(r => r.json()),
      api('/api/group-value/totals?period=all').then(r => r.json()),
    ]).then(([s, vs, vr, gc, b, m, gv]) => {
      setStats(s)
      setVotingStatus(vs)
      setResults(vr)
      setGuestCount(gc)
      setBirthdays(b)
      setMemberCount(m.length)
      setGvTotal(gv?.total_amount || 0)
      if (gc.date) api(`/api/guests?date=${gc.date}`).then(r => r.json()).then(g => setRecentGuests(g.slice(0, 5)))
    })
  }, [])

  const openVoting = async () => {
    setLoading(true)
    await api('/api/voting/open', { method: 'POST' })
    const [vs, vr] = await Promise.all([
      api('/api/voting/status').then(r => r.json()),
      api('/api/voting/results').then(r => r.json()),
    ])
    setVotingStatus(vs); setResults(vr)
    setLoading(false)
  }

  const closeVoting = async () => {
    setLoading(true)
    await api('/api/voting/close', { method: 'POST' })
    if (results[0]) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    const [vs, vr] = await Promise.all([
      api('/api/voting/status').then(r => r.json()),
      api('/api/voting/results').then(r => r.json()),
    ])
    setVotingStatus(vs); setResults(vr)
    setLoading(false)
  }

  const chartData = [...stats].reverse().map(s => ({
    name: s.date.slice(0, 5), Guests: s.total, Paid: s.paid,
  }))

  const maxVotes = results[0]?.votes || 1

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button onClick={onInvite}
          className="px-4 py-2 rounded-xl text-white text-sm font-semibold flex items-center gap-2"
          style={{ background: RED }}>
          <Plus size={15} /> {t('dashboard.inviteGuest')}
        </button>
      </div>

      {/* Next Meeting Management */}
      <div className="bg-white rounded-2xl px-5 py-3.5 shadow-sm flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
          <Calendar size={14} className="text-gray-400" />
          Следующая встреча:
        </span>
        <div className="flex items-center gap-0.5 border border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => nextMeeting && saveMeeting(shiftDDMM(nextMeeting, -7))}
            disabled={savingMeeting || !nextMeeting}
            className="px-2 py-1.5 hover:bg-gray-50 text-gray-500 disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-gray-900 min-w-[56px] text-center px-1">
            {nextMeeting || '—'}
          </span>
          <button onClick={() => nextMeeting && saveMeeting(shiftDDMM(nextMeeting, 7))}
            disabled={savingMeeting || !nextMeeting}
            className="px-2 py-1.5 hover:bg-gray-50 text-gray-500 disabled:opacity-30 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
        <button onClick={() => saveMeeting(getNextMonday())} disabled={savingMeeting}
          className="text-xs px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors">
          Авто
        </button>
        {savingMeeting && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: t('dashboard.members'),    value: memberCount,                         icon: <UserCheck size={18} />,    color: 'bg-blue-50 text-blue-600' },
          { label: t('dashboard.guests'),     value: guestCount.count,                    icon: <Users size={18} />,        color: 'bg-purple-50 text-purple-600' },
          { label: 'Group Value',             value: `₪${gvTotal.toLocaleString()}`,      icon: <DollarSign size={18} />,   color: 'bg-green-50 text-green-600' },
          { label: t('dashboard.attendance'), value: '94%',                               icon: <CheckCircle2 size={18} />, color: 'bg-amber-50 text-amber-600' },
        ] as { label: string; value: string | number; icon: React.ReactNode; color: string }[]).map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className={cn('inline-flex p-2.5 rounded-xl mb-2', c.color)}>{c.icon}</div>
            <p className="text-2xl font-bold text-gray-900">{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Row 2: Guests + Birthdays */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent guests */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">
              {t('dashboard.latestGuests')} · <span className="text-gray-400 font-normal text-sm">{guestCount.date}</span>
            </h2>
            <span className="text-sm font-medium text-gray-900">{guestCount.count} {t('dashboard.total')}</span>
          </div>
          {recentGuests.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noGuests')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recentGuests.map(g => (
                  <tr key={g.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 font-medium text-gray-800">{g.name}</td>
                    <td className="py-2 text-gray-400 text-xs">{g.specialty}</td>
                    <td className="py-2 text-right">
                      {g.paid
                        ? <span className="text-green-500 text-xs font-medium">{t('dashboard.paid')}</span>
                        : <span className="text-gray-300 text-xs">{t('dashboard.unpaid')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* chart */}
          {chartData.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-400 mb-2">{t('dashboard.lastMeetings')}</p>
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={chartData} barSize={10}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="Guests" fill="#e5e7eb" radius={[3,3,0,0]} />
                  <Bar dataKey="Paid" fill={RED} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Birthdays */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-3">{t('dashboard.upcomingBirthdays')}</h2>
          {birthdays.length === 0
            ? <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noUpcomingBirthdays')}</p>
            : <div>{birthdays.map(m => <BirthdayRow key={m.id} member={m} />)}</div>
          }
        </div>
      </div>

      {/* Row 3: Voting */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="font-semibold text-gray-800">{t('dashboard.voting')}</h2>
          {votingStatus && (
            <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
              votingStatus.open ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
              <div className={cn('w-2 h-2 rounded-full', votingStatus.open ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} />
              {votingStatus.open ? t('dashboard.open') : t('dashboard.closed')} · {votingStatus.voteCount}/{votingStatus.expected}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            {!votingStatus?.open
              ? <button onClick={openVoting} disabled={loading}
                  className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: RED }}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : t('dashboard.openVoting')}
                </button>
              : <button onClick={closeVoting} disabled={loading}
                  className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-medium disabled:opacity-50">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : t('dashboard.closeVoting')}
                </button>
            }
          </div>
        </div>
        {results.length > 0 && (
          <div className="mt-4 flex gap-3 flex-wrap">
            {results.slice(0, 3).map((r, i) => (
              <div key={r.candidateId} className={cn('flex-1 min-w-24 rounded-xl p-3 text-center',
                i === 0 ? 'bg-amber-50' : 'bg-gray-50')}>
                <p className="text-xs text-gray-400 mb-0.5">{i === 0 ? '🏆' : `#${i+1}`}</p>
                <p className="text-sm font-semibold text-gray-800 truncate">{r.candidateName}</p>
                <p className="text-xs font-bold mt-0.5" style={i === 0 ? { color: '#D97706' } : { color: '#6B7280' }}>{r.votes} {t('dashboard.votes')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Guests Section ──────────────────────────────────────────────────────────

function GuestsSection() {
  const { t } = useTranslation()
  const [meetings, setMeetings] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [guests, setGuests] = useState<Guest[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [nextMeeting, setNextMeeting] = useState('')
  const [sendingCatalog, setSendingCatalog] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [showAddDate, setShowAddDate] = useState(false)
  const [addDateVal, setAddDateVal] = useState('')

  useEffect(() => {
    Promise.all([
      api('/api/meetings').then(r => r.json()),
      api('/api/settings/next-meeting').then(r => r.json()),
    ]).then(([m, s]) => {
      setMeetings(m); setNextMeeting(s.date || '')
      if (m.length) setSelectedDate(m[0])
    })
  }, [])

  useEffect(() => {
    if (!selectedDate) return
    setLoading(true)
    api(`/api/guests?date=${selectedDate}`).then(r => r.json()).then(g => { setGuests(g); setLoading(false) })
  }, [selectedDate])

  const filtered = guests.filter(g =>
    `${g.name} ${g.phone} ${g.specialty}`.toLowerCase().includes(search.toLowerCase()))

  const markPaid = async (id: string) => {
    await api(`/api/guests/${id}/paid`, { method: 'PUT' })
    setGuests(gs => gs.map(g => g.id === id ? { ...g, paid: 1 } : g))
  }

  const toggleWa = async (id: string) => {
    const r = await api(`/api/guests/${id}/wa-toggle`, { method: 'PATCH' })
    const { wa_enabled } = await r.json()
    setGuests(gs => gs.map(g => g.id === id ? { ...g, wa_enabled } : g))
  }

  const paid = guests.filter(g => g.paid).length

  const sendCatalog = async () => {
    if (!selectedDate || sendingCatalog) return
    setSendingCatalog(true)
    try {
      const r = await api('/api/whatsapp/send-catalog', { method: 'POST', body: JSON.stringify({ meeting_date: selectedDate }) })
      const { sent } = await r.json()
      setToastMsg(t('guests.catalogSent', { n: sent }))
      setTimeout(() => setToastMsg(''), 4000)
    } finally {
      setSendingCatalog(false)
    }
  }

  return (
    <div className="space-y-5">
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-3 rounded-xl text-sm shadow-lg z-50 whitespace-nowrap">
          {toastMsg}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('guests.title')}</h1>
        <div className="flex gap-2">
          <button onClick={sendCatalog} disabled={sendingCatalog || !selectedDate}
            className="text-xs px-3 py-2 rounded-xl border border-green-200 bg-white text-green-600 hover:border-green-300 flex items-center gap-1.5 disabled:opacity-50">
            {sendingCatalog ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {t('guests.sendCatalog')}
          </button>
          <a href="/api/pdf/list" target="_blank" className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-gray-300 flex items-center gap-1.5">
            <Download size={13} /> {t('guests.exportPdfList')}
          </a>
          <a href="/api/pdf/badges" target="_blank" className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-gray-300 flex items-center gap-1.5">
            <Download size={13} /> {t('guests.exportPdfBadges')}
          </a>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Arrow navigator — meetings[0]=newest, higher index=older; ←=older, →=newer */}
        <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden bg-white">
          <button
            onClick={() => { const i = meetings.indexOf(selectedDate); if (i < meetings.length - 1) setSelectedDate(meetings[i + 1]) }}
            disabled={meetings.indexOf(selectedDate) >= meetings.length - 1}
            className="px-2 py-2 hover:bg-gray-50 text-gray-500 disabled:opacity-30 transition-colors"
            title="Старее">
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm font-semibold text-gray-900 min-w-[120px] text-center px-1">
            {selectedDate || '—'}
            {selectedDate === nextMeeting && <span className="ml-1 text-xs font-normal text-gray-400">{t('guests.next')}</span>}
            {selectedDate && <span className="ml-1 text-xs font-normal text-gray-400">· {guests.length}</span>}
          </span>
          <button
            onClick={() => { const i = meetings.indexOf(selectedDate); if (i > 0) setSelectedDate(meetings[i - 1]) }}
            disabled={meetings.indexOf(selectedDate) <= 0}
            className="px-2 py-2 hover:bg-gray-50 text-gray-500 disabled:opacity-30 transition-colors"
            title="Новее">
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Dot indicators */}
        {meetings.length > 1 && (
          <div className="flex gap-1.5 items-center">
            {meetings.map(d => (
              <button key={d} onClick={() => setSelectedDate(d)}
                className="rounded-full transition-all"
                style={{
                  width: selectedDate === d ? 8 : 6,
                  height: selectedDate === d ? 8 : 6,
                  background: selectedDate === d ? RED : '#d1d5db',
                }} />
            ))}
          </div>
        )}

        {/* Add date */}
        {showAddDate ? (
          <div className="flex items-center gap-1.5">
            <input value={addDateVal} onChange={e => setAddDateVal(e.target.value)} placeholder="ДД/ММ"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-20 focus:outline-none focus:border-red-400" />
            <button onClick={() => {
              const v = addDateVal.trim()
              if (v && !meetings.includes(v)) { setMeetings(m => [v, ...m]); setSelectedDate(v) }
              else if (v && meetings.includes(v)) setSelectedDate(v)
              setAddDateVal(''); setShowAddDate(false)
            }} className="text-xs px-2.5 py-1.5 rounded-lg text-white font-medium" style={{ background: RED }}>
              OK
            </button>
            <button onClick={() => { setShowAddDate(false); setAddDateVal('') }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600">
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddDate(true)}
            className="text-xs px-3 py-1.5 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors">
            <Plus size={12} /> Добавить дату
          </button>
        )}
      </div>

      {selectedDate && (
        <div className="flex gap-3 text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{guests.length}</span> {t('guests.guests')} ·
          <span className="text-green-600 font-semibold">{paid}</span> {t('guests.paid')} ·
          <span className="text-gray-400">{guests.length - paid}</span> {t('guests.unpaid')}
        </div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('guests.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 bg-white" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">{search ? t('guests.nothingFound') : t('guests.noGuests')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">{t('guests.colName')}</th>
                <th className="px-4 py-3 font-medium">{t('guests.colPhone')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('guests.colSpecialty')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('guests.colInvitedBy')}</th>
                <th className="px-4 py-3 font-medium">{t('guests.colWA')}</th>
                <th className="px-4 py-3 font-medium">{t('guests.colPayment')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    <a href={`https://wa.me/${waPhone(g.phone)}`} target="_blank" rel="noopener noreferrer"
                      className="hover:text-green-600 flex items-center gap-1"><Phone size={11} />{g.phone}</a>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{g.specialty}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{g.invitedBy}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleWa(g.id)}
                      className={cn('px-2 py-1 rounded-full text-xs font-medium', g.wa_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                      {g.wa_enabled ? t('guests.waOn') : t('guests.waOff')}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {g.paid
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 size={13} /> {t('guests.paidLabel')}</span>
                      : <button onClick={() => markPaid(g.id)} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium">{t('guests.markPaid')}</button>}
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
  const { t } = useTranslation()
  const [members, setMembers] = useState<Member[]>([])
  const [memberSocials, setMemberSocials] = useState<Record<number, MemberSocial[]>>({})
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editingMember, setEditingMember] = useState<Member | null | undefined>(undefined) // undefined = closed, null = new
  const [inviteModal, setInviteModal] = useState<Member | null>(null)
  const [nextMeeting, setNextMeeting] = useState('')
  const [loading, setLoading] = useState(true)
  const [birthdays, setBirthdays] = useState<(Member & { daysUntil: number })[]>([])

  const load = useCallback(async () => {
    const [m, s, b] = await Promise.all([
      api('/api/members').then(r => r.json()),
      api('/api/settings/next-meeting').then(r => r.json()),
      api('/api/birthdays/upcoming?days=14').then(r => r.json()),
    ])
    setMembers(m)
    setNextMeeting(s.date || '')
    setBirthdays(b)
    setLoading(false)
    // Fetch socials for active members
    const active: Member[] = m.filter((x: Member) => x.active)
    const socialsEntries = await Promise.all(
      active.map((mem: Member) => api(`/api/members/${mem.id}/socials`).then(r => r.json()).then((s: MemberSocial[]) => [mem.id, s] as const))
    )
    setMemberSocials(Object.fromEntries(socialsEntries))
  }, [])

  useEffect(() => { load() }, [load])

  const onSaved = (saved: Member) => {
    setMembers(ms => {
      const idx = ms.findIndex(m => m.id === saved.id)
      return idx >= 0 ? ms.map(m => m.id === saved.id ? saved : m) : [...ms, saved]
    })
    setEditingMember(undefined)
    load()
  }

  const toggleActive = async (m: Member) => {
    if (m.active) {
      await api(`/api/members/${m.id}`, { method: 'DELETE' })
    } else {
      await api(`/api/members/${m.id}/activate`, { method: 'PATCH' })
    }
    setMembers(ms => ms.map(x => x.id === m.id ? { ...x, active: m.active ? 0 : 1 } : x))
  }

  const displayed = members
    .filter(m => showInactive || m.active)
    .filter(m => `${m.name} ${m.profession}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-5">
      {/* Birthdays block */}
      {birthdays.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-3">{t('members.upcomingBirthdays')}</h2>
          {birthdays.map(m => <BirthdayRow key={m.id} member={m} />)}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('members.title')}</h1>
        <div className="flex gap-2">
          <a href="/api/pdf/members" target="_blank"
            className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-gray-300 flex items-center gap-1.5">
            <Download size={13} /> {t('members.pdfCatalog')}
          </a>
          <button onClick={() => setEditingMember(null)}
            className="text-xs px-4 py-2 rounded-xl text-white flex items-center gap-1.5" style={{ background: RED }}>
            <Plus size={14} /> {t('members.addMember')}
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('members.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 bg-white" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          {t('members.showInactive')}
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium w-10" />
                <th className="px-4 py-3 font-medium">{t('members.colName')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('members.colProfession')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('members.colPhone')}</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">{t('members.colBirthday')}</th>
                <th className="px-4 py-3 font-medium">{t('members.colSocials')}</th>
                <th className="px-4 py-3 font-medium w-20">{t('members.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(m => (
                <tr key={m.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', !m.active && 'opacity-50')}>
                  <td className="px-4 py-2.5">
                    <Avatar member={m} size={36} />
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-400 md:hidden">{m.profession}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{m.profession}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    {m.phone && (
                      <a href={`https://wa.me/${waPhone(m.phone)}`} target="_blank" rel="noopener noreferrer"
                        className="text-gray-500 hover:text-green-600 flex items-center gap-1 text-xs">
                        <Phone size={11} /> {m.phone}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs hidden xl:table-cell">
                    {m.birthday && <span>🎂 {m.birthday}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <SocialIcons socials={memberSocials[m.id] || []} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => setEditingMember(m)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600" title={t('members.editTitle')}>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setInviteModal(m)}
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600" title={t('members.inviteTitle')}>
                        <UserCheck size={14} />
                      </button>
                      <button onClick={() => toggleActive(m)}
                        className={cn('p-1.5 rounded-lg text-gray-400 transition-colors',
                          m.active ? 'hover:bg-red-50 hover:text-red-500' : 'hover:bg-green-50 hover:text-green-500')}
                        title={m.active ? t('members.deactivate') : t('members.activate')}>
                        {m.active ? <Trash2 size={14} /> : <RefreshCw size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayed.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">{t('members.noMembers')}</div>
          )}
        </div>
      )}

      <AnimatePresence>
        {editingMember !== undefined && (
          <MemberModal
            member={editingMember}
            onClose={() => setEditingMember(undefined)}
            onSaved={onSaved}
          />
        )}
        {inviteModal && (
          <InviteModal members={members.filter(m => m.active)} defaultMember={inviteModal} nextMeeting={nextMeeting} onClose={() => setInviteModal(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Voting Section ──────────────────────────────────────────────────────────

function VotingSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<VotingStatus | null>(null)
  const [results, setResults] = useState<VoteResult[]>([])
  const [winners, setWinners] = useState<VoteWinner[]>([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const [s, r, w] = await Promise.all([
      api('/api/voting/status').then(x => x.json()),
      api('/api/voting/results').then(x => x.json()),
      api('/api/voting/winners').then(x => x.json()),
    ])
    setStatus(s); setResults(r); setWinners(w)
    setLastUpdated(new Date())
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!status?.open) return
    const interval = setInterval(() => { load() }, 10000)
    return () => clearInterval(interval)
  }, [status?.open, load])

  const openVoting = async () => { setLoading(true); await api('/api/voting/open', { method: 'POST' }); await load(); setLoading(false) }
  const closeVoting = async () => {
    setLoading(true); await api('/api/voting/close', { method: 'POST' })
    if (results[0]) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    await load(); setLoading(false)
  }

  const maxVotes = results[0]?.votes || 1

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">{t('voting.title')}</h1>
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <div className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold',
            status?.open ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600')}>
            <div className={cn('w-2.5 h-2.5 rounded-full', status?.open ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} />
            {status?.open ? t('voting.isOpen') : t('voting.isClosed')}
          </div>
          {status && <div className="text-sm text-gray-500"><span className="font-semibold text-gray-900">{status.voteCount}</span> / {status.expected} votes</div>}
          <div className="flex gap-2 ml-auto">
            {!status?.open
              ? <button onClick={openVoting} disabled={loading} className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50" style={{ background: RED }}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : t('voting.openVoting')}
                </button>
              : <button onClick={closeVoting} disabled={loading} className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-medium disabled:opacity-50">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : t('voting.closeVoting')}
                </button>
            }
          </div>
        </div>
      </div>
      {results.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-0.5">{t('voting.currentResults')}</h2>
          <p className="text-xs text-gray-400 mb-4">
            {status?.open
              ? t('voting.updatesEveryWithLast', { time: lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—' })
              : t('voting.lastUpdated', { time: lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—' })
            }
          </p>
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={r.candidateId} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={i === 0 ? { background: '#FEF3C7', color: '#D97706' } : { background: '#F3F4F6', color: '#6B7280' }}>
                  {i === 0 ? '🏆' : i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800">{r.candidateName}</span>
                    <span className="text-gray-500">{r.votes}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.votes / maxVotes) * 100}%`, background: i === 0 ? '#F59E0B' : RED }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {winners.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">{t('voting.recentWinners')}</h2>
          <div className="space-y-3">
            {winners.map((w, i) => (
              <div key={w.date} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: i === 0 ? '#FEF3C7' : '#F3F4F6' }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">{w.winner_name}</p>
                  <p className="text-xs text-gray-400">{w.date} · {w.votes} votes</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Group Value Section ─────────────────────────────────────────────────────

function GroupValueSection() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<Period>('all')
  const [totals, setTotals] = useState<StatTotals | null>(null)
  const [history, setHistory] = useState<MeetingStatEntry[]>([])

  // Calculator state
  const today = new Date()
  const [meetingDate, setMeetingDate] = useState(
    `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}`
  )
  const [pending, setPending] = useState<PendingRow[]>([])
  const [nextLocalId, setNextLocalId] = useState(1)

  // Current input row
  const [inp1on1, setInp1on1] = useState(0)
  const [inpRef, setInpRef] = useState(0)
  const [inpDeals, setInpDeals] = useState(0)
  const [inpAmounts, setInpAmounts] = useState('')

  // Save modal
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)

  // Derived from amount text
  const parsedAmts = inpAmounts.split(',').map(s => Number(s.trim())).filter(n => n > 0 && !isNaN(n))
  const inpAmount = parsedAmts.reduce((a, b) => a + b, 0)

  // Pending totals
  const pt = pending.reduce((acc, r) => ({
    meetings_1on1: acc.meetings_1on1 + r.meetings_1on1,
    referrals:     acc.referrals     + r.referrals,
    closed_deals:  acc.closed_deals  + r.closed_deals,
    deal_amount:   acc.deal_amount   + r.deal_amount,
  }), { meetings_1on1: 0, referrals: 0, closed_deals: 0, deal_amount: 0 })

  const loadTotals = useCallback(async (p: Period) => {
    const t = await api(`/api/meeting-stats/totals?period=${p}`).then(r => r.json())
    setTotals(t)
  }, [])

  const loadHistory = useCallback(async () => {
    setHistory(await api('/api/meeting-stats').then(r => r.json()))
  }, [])

  useEffect(() => { loadHistory(); loadTotals(period) }, []) // eslint-disable-line
  useEffect(() => { loadTotals(period) }, [period, loadTotals])

  const addRow = () => {
    if (!inp1on1 && !inpRef && !inpDeals && !inpAmount) return
    setPending(p => [...p, { localId: nextLocalId, meetings_1on1: inp1on1, referrals: inpRef, closed_deals: inpDeals, deal_amount: inpAmount }])
    setNextLocalId(n => n + 1)
    setInp1on1(0); setInpRef(0); setInpDeals(0); setInpAmounts('')
  }

  const removeRow = (id: number) => setPending(p => p.filter(r => r.localId !== id))

  const openModal = () => {
    if (!meetingDate || !pending.length) return
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 } })
    setShowModal(true)
  }

  const confirmSave = async () => {
    setSaving(true)
    try {
      await api('/api/meeting-stats', { method: 'POST', body: JSON.stringify({ meeting_date: meetingDate, ...pt }) })
      const report = `📊 BNI Report ${meetingDate}:\n🤝 1-on-1: ${pt.meetings_1on1}\n📄 Referrals: ${pt.referrals}\n🔐 Deals: ${pt.closed_deals}\n💰 Total: ₪${pt.deal_amount.toLocaleString()}`
      try { await navigator.clipboard.writeText(report) } catch {}
      setPending([]); setShowModal(false)
      loadHistory(); loadTotals(period)
    } finally { setSaving(false) }
  }

  const deleteHistoryEntry = async (id: number) => {
    await api(`/api/meeting-stats/${id}`, { method: 'DELETE' })
    setHistory(h => h.filter(e => e.id !== id))
    loadTotals(period)
  }

  const PERIODS: { id: Period; label: string }[] = [
    { id: 'week', label: t('groupValue.week') }, { id: 'month', label: t('groupValue.month') },
    { id: 'quarter', label: t('groupValue.quarter') }, { id: 'all', label: t('groupValue.allTime') },
  ]

  const Counter = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="flex items-center justify-center gap-1">
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="w-7 h-7 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 text-base leading-none flex items-center justify-center flex-shrink-0">−</button>
      <input
        type="number" min={0} value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-10 text-center text-sm font-bold text-gray-900 bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button onClick={() => onChange(value + 1)}
        className="w-7 h-7 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 text-base leading-none flex items-center justify-center flex-shrink-0">+</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Group Value</h1>


      {/* Period filter */}
      <div className="flex gap-1.5">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              period === p.id ? 'text-white' : 'bg-white text-gray-500 border border-gray-200')}
            style={period === p.id ? { background: RED } : {}}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI Totals */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { label: t('groupValue.oneOnOne'),    value: totals.total_1on1,                                 icon: <Handshake size={18} />,  color: 'bg-blue-50 text-blue-600' },
            { label: t('groupValue.referrals'),   value: totals.total_referrals,                            icon: <Users size={18} />,      color: 'bg-purple-50 text-purple-600' },
            { label: t('groupValue.closedDeals'), value: totals.total_deals,                                icon: <Trophy size={18} />,     color: 'bg-amber-50 text-amber-600' },
            { label: t('groupValue.totalAmount'), value: `₪${(totals.total_amount||0).toLocaleString()}`,   icon: <DollarSign size={18} />, color: 'bg-green-50 text-green-600' },
          ] as { label: string; value: string|number; icon: React.ReactNode; color: string }[]).map(c => (
            <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className={cn('inline-flex p-2.5 rounded-xl mb-2', c.color)}>{c.icon}</div>
              <p className="text-xl font-bold text-gray-900">{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Calculator ── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h2 className="font-semibold text-gray-800">{t('groupValue.meetingEntry')}</h2>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">{t('groupValue.date')}</span>
            <DatePickerInput value={meetingDate} onChange={setMeetingDate} />
          </div>
        </div>

        {/* Input row — 4 equal columns */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: t('groupValue.oneOnOne'),  node: <Counter value={inp1on1} onChange={setInp1on1} /> },
            { label: t('groupValue.referrals'), node: <Counter value={inpRef}   onChange={setInpRef} /> },
            { label: t('groupValue.deals'),     node: <Counter value={inpDeals} onChange={setInpDeals} /> },
            { label: t('groupValue.amountLabel'), node:
              <input value={inpAmounts} onChange={e => { const v = e.target.value; setInpAmounts(v); const parsed = v.split(',').map(s => Number(s.trim())).filter(n => n > 0 && !isNaN(n)); setInpDeals(parsed.length) }}
                placeholder={t('groupValue.amountsPlaceholder')} onKeyDown={e => e.key === 'Enter' && addRow()}
                className="w-full h-9 border border-gray-200 rounded-lg px-2 text-center text-sm focus:outline-none focus:border-red-400" />
            },
          ].map(col => (
            <div key={col.label} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[11px] text-gray-400 text-center mb-2 font-medium uppercase tracking-wide">{col.label}</p>
              {col.node}
            </div>
          ))}
        </div>

        <button onClick={addRow}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 text-sm hover:border-red-300 hover:text-red-500 transition-colors flex items-center justify-center gap-2">
          <Plus size={15} /> {t('groupValue.addRow')}
        </button>
      </div>

      {/* Pending table */}
      {pending.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium text-left">#</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.oneOnOne')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.referrals')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.deals')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('groupValue.amountLabel')}</th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {pending.map((row, idx) => (
                <tr key={row.localId} className="border-b border-gray-50">
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{row.meetings_1on1}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{row.referrals}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{row.closed_deals}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">₪{row.deal_amount.toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => removeRow(row.localId)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {/* ИТОГО row */}
              <tr className="bg-gray-50 text-sm font-semibold text-gray-900 border-t border-gray-100">
                <td className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide">{t('groupValue.total')}</td>
                <td className="px-4 py-3 text-center">{pt.meetings_1on1}</td>
                <td className="px-4 py-3 text-center">{pt.referrals}</td>
                <td className="px-4 py-3 text-center">{pt.closed_deals}</td>
                <td className="px-4 py-3 text-right">₪{pt.deal_amount.toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="p-4 border-t border-gray-100">
            <button onClick={openModal} disabled={!meetingDate || !pending.length}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: RED }}>
              {t('groupValue.calculateSave')}
            </button>
          </div>
        </div>
      )}

      {/* History table */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">{t('groupValue.history')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium text-left">{t('common.date')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.oneOnOne')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.referrals')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('groupValue.deals')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('groupValue.amountLabel')}</th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {history.map(e => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.meeting_date}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.meetings_1on1}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.referrals}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{e.closed_deals}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700">₪{e.deal_amount.toLocaleString()}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => deleteHistoryEntry(e.id)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Save modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowModal(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-5">
                <div className="text-4xl mb-2">🎉</div>
                <h3 className="text-lg font-bold text-gray-900">{t('groupValue.meetingSummary')}</h3>
                <p className="text-sm text-gray-500 mt-1">{meetingDate}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: t('groupValue.oneOnOne'),  value: pt.meetings_1on1 },
                  { label: t('groupValue.referrals'), value: pt.referrals },
                  { label: t('groupValue.deals'),     value: pt.closed_deals },
                  { label: t('groupValue.amount'),    value: `₪${pt.deal_amount.toLocaleString()}` },
                ].map(c => (
                  <div key={c.label} className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-xl font-bold text-gray-900">{c.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center mb-4">{t('groupValue.reportCopied')}</p>
              <div className="flex gap-2">
                <button onClick={confirmSave} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                  style={{ background: RED }}>
                  {saving ? t('common.saving') : t('groupValue.saveCopy')}
                </button>
                <button onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Presentations Section ───────────────────────────────────────────────────

function PresentationsSection() {
  const { t } = useTranslation()
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
    ]).then(([p, m, s]) => { setItems(p); setMembers(m); setNextMeeting(s.date || ''); setLoading(false) })
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

  const startAdd = () => { setAdding(true); setEditing(null); setForm({ meeting_date: nextMeeting, member_name: '', change_description: '', notes: '' }) }
  const startEdit = (p: Presentation) => { setEditing(p); setAdding(false); setForm({ meeting_date: p.meeting_date, member_name: p.member_name, change_description: p.change_description, notes: p.notes }) }

  const grouped = items.reduce<Record<string, Presentation[]>>((acc, p) => {
    ;(acc[p.meeting_date] = acc[p.meeting_date] || []).push(p); return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('presentations.title')}</h1>
        <button onClick={startAdd} className="text-sm px-4 py-2 rounded-xl text-white flex items-center gap-2" style={{ background: RED }}>
          <Plus size={14} /> {t('presentations.add')}
        </button>
      </div>

      <AnimatePresence>
        {(adding || editing !== null) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-red-100">
            <h3 className="font-semibold text-gray-800 mb-4">{editing ? t('presentations.editPresentation') : t('presentations.newPresentation')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('presentations.meetingDateLabel')}</label>
                <DatePickerInput value={form.meeting_date} onChange={v => setForm(f => ({ ...f, meeting_date: v }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('presentations.memberLabel')}</label>
                <select value={form.member_name} onChange={e => setForm(f => ({ ...f, member_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400">
                  <option value="">{t('presentations.selectMember')}</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('presentations.descriptionLabel')}</label>
                <input value={form.change_description} onChange={e => setForm(f => ({ ...f, change_description: e.target.value }))}
                  placeholder={t('presentations.descriptionPlaceholder')} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('presentations.notesLabel')}</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={saving || !form.member_name || !form.change_description}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50" style={{ background: RED }}>
                {saving ? t('presentations.saving') : t('presentations.save')}
              </button>
              <button onClick={() => { setAdding(false); setEditing(null) }}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium">{t('presentations.cancel')}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : (
        Object.entries(grouped).map(([date, pItems]) => (
          <div key={date} className="space-y-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{date}</h2>
            {pItems.map(p => (
              <div key={p.id} className={cn('bg-white rounded-xl p-4 shadow-sm flex items-start gap-3', p.status === 'done' && 'opacity-60')}>
                <button onClick={() => toggle(p.id)}
                  className={cn('mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
                    p.status === 'done' ? 'border-green-500 bg-green-500' : 'border-gray-300')}>
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
  const { i18n } = useTranslation()
  const isRtl = i18n.language === 'he'
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('admin_token'))
  const [section, setSection] = useState<Section>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [inviteForDashboard, setInviteForDashboard] = useState(false)
  const [nextMeeting, setNextMeeting] = useState('')
  const [allMembers, setAllMembers] = useState<Member[]>([])

  useEffect(() => {
    if (!authed) return
    Promise.all([
      api('/api/settings/next-meeting').then(r => r.json()),
      api('/api/members?active=true').then(r => r.json()),
    ]).then(([s, m]) => {
      setNextMeeting(s.date || '')
      setAllMembers(m)
    })
  }, [authed])

  const logout = () => { localStorage.removeItem('admin_token'); setAuthed(false) }

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  const sidebarW = collapsed ? 64 : 240

  const SECTIONS: Record<Section, React.ReactNode> = {
    dashboard:     <Dashboard onInvite={() => setInviteForDashboard(true)} nextMeeting={nextMeeting} onNextMeetingChange={setNextMeeting} />,
    guests:        <GuestsSection />,
    members:       <MembersSection />,
    voting:        <VotingSection />,
    'group-value': <GroupValueSection />,
    presentations: <PresentationsSection />,
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar section={section} collapsed={collapsed} onNav={setSection}
        onCollapse={() => setCollapsed(c => !c)} onLogout={logout} />
      <main className="transition-all duration-300 min-h-screen"
        style={isRtl ? { paddingRight: sidebarW } : { paddingLeft: sidebarW }}>
        <div className="p-6 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
              {SECTIONS[section]}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      {/* Global invite modal triggered from dashboard */}
      <AnimatePresence>
        {inviteForDashboard && allMembers.length > 0 && (
          <InviteModal members={allMembers} nextMeeting={nextMeeting} onClose={() => setInviteForDashboard(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
