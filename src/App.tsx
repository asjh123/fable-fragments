import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { sampleContents } from './content'
import { contentKey, type ContentPack } from './domain/content'
import { completedFragments, createLearningEvent, didStudyOn, latestNote, shanghaiDate, type EventType, type LearningEvent } from './domain/events'
import { db } from './data/db'
import { clearLocalData, exportBackup, getDeviceId, getLocalUserId, importBackupText, importContentText, saveContent, saveEvent } from './data/repository'
import { cloudConfigured, ownerEmail, remoteAdapter, sendMagicLink, signInWithSyncPassword, signOut, supabase, updateSyncPassword } from './sync/supabase'
import { syncNow } from './sync/syncEngine'

type View = 'home' | 'reader' | 'settings'
type SyncLabel = '本地保存' | '云端已同步' | '离线使用中' | '正在同步' | '部分同步' | '同步失败，可重试'

const formatTime = (iso?: string) => iso
  ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  : '还没有学习记录'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作没有完成，请稍后重试'

export function App() {
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem('activeView')
    return saved === 'reader' || saved === 'settings' ? saved : 'home'
  })
  const [contents, setContents] = useState<ContentPack[]>([])
  const [events, setEvents] = useState<LearningEvent[]>([])
  const [currentKey, setCurrentKey] = useState('')
  const [fragmentIndex, setFragmentIndex] = useState(0)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('theme') === 'dark' ? 'dark' : 'light')
  const [syncLabel, setSyncLabel] = useState<SyncLabel>(cloudConfigured ? '正在同步' : '本地保存')
  const [notice, setNotice] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState(ownerEmail)
  const [loginPassword, setLoginPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [quizChoice, setQuizChoice] = useState<number | null>(null)
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)
  const online = useOnlineStatus()
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()

  const current = useMemo(() => contents.find((pack) => contentKey(pack.contentId, pack.version) === currentKey) ?? contents[0], [contents, currentKey])
  const done = useMemo(() => current ? completedFragments(events, current.contentId, current.version) : new Set<string>(), [events, current])
  const revealed = useMemo(() => current ? events.some((event) => event.contentId === current.contentId && event.contentVersion === current.version && event.eventType === 'CONCEPT_VIEWED') || fragmentIndex >= 3 : false, [events, current, fragmentIndex])
  const studiedToday = didStudyOn(events)
  const lastEvent = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]

  const refresh = useCallback(async () => {
    const [storedContents, storedEvents, selected] = await Promise.all([
      db.contents.toArray(), db.events.toArray(), db.settings.get('currentContent')
    ])
    const packs = storedContents.map(({ key: _key, ...pack }) => pack)
    setContents(packs)
    setEvents(storedEvents)
    setPendingCount(storedEvents.filter((event) => event.syncStatus !== 'synced').length)
    const selectedKey = typeof selected?.value === 'string' ? selected.value : packs[0] ? contentKey(packs[0].contentId, packs[0].version) : ''
    setCurrentKey(selectedKey)
    if (selectedKey) {
      const position = await db.settings.get(`position:${selectedKey}`)
      const chosen = packs.find((pack) => contentKey(pack.contentId, pack.version) === selectedKey)
      if (chosen) {
        const storedPosition = typeof position?.value === 'number' ? position.value : 0
        const completed = completedFragments(storedEvents, chosen.contentId, chosen.version)
        const firstIncomplete = chosen.fragments.findIndex((fragment) => !completed.has(fragment.fragmentId))
        const derivedPosition = firstIncomplete === -1 ? chosen.fragments.length - 1 : firstIncomplete
        setFragmentIndex(Math.max(storedPosition, derivedPosition))
        setNote(latestNote(storedEvents, chosen.contentId, chosen.version))
      }
    }
  }, [])

  const runSync = useCallback(async (quiet = false) => {
    if (!online) { setSyncLabel('离线使用中'); return }
    if (!remoteAdapter) { setSyncLabel('本地保存'); return }
    setSyncLabel('正在同步')
    try {
      const result = await syncNow(remoteAdapter)
      setSyncLabel(result.status === 'synced' ? '云端已同步' : result.status === 'partial' ? '部分同步' : '本地保存')
      setLastSyncError(result.errorMessage ?? null)
      if (result.status === 'synced') setLastSyncedAt(new Date().toISOString())
      await refresh()
      if (!quiet) setNotice(result.status === 'synced'
        ? `同步完成：上传 ${result.uploaded} 条，接收 ${result.downloaded} 条，更新内容 ${result.contentsDownloaded} 个`
        : `部分同步：${result.errorMessage ?? '请稍后重试'}`)
    } catch (error) {
      setSyncLabel('同步失败，可重试')
      setLastSyncError(errorMessage(error))
      if (!quiet) setNotice('云端暂时无法连接，本机记录不会丢失。')
    }
  }, [online, refresh])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    sessionStorage.setItem('activeView', view)
  }, [view])

  useEffect(() => {
    void (async () => {
      if ((await db.contents.count()) === 0) for (const pack of sampleContents) await saveContent(pack)
      await refresh()
    })()
  }, [refresh])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(async ({ data }) => {
      setUserEmail(data.session?.user.email ?? null)
      if (data.session) {
        const userId = data.session.user.id
        const [last, failure] = await Promise.all([db.settings.get(`lastSync:${userId}`), db.settings.get(`lastSyncError:${userId}`)])
        setLastSyncedAt(typeof last?.value === 'string' ? last.value : null)
        setLastSyncError(typeof failure?.value === 'string' ? failure.value : null)
        void runSync(true)
      }
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null)
      if (session) void runSync(true)
    })
    return () => data.subscription.unsubscribe()
  }, [runSync])

  useEffect(() => {
    const onOnline = () => void runSync(true)
    window.addEventListener('online', onOnline)
    if (!online) setSyncLabel('离线使用中')
    return () => window.removeEventListener('online', onOnline)
  }, [online, runSync])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void runSync(true) }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void runSync(true) }, 15 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer) }
  }, [runSync])

  const record = useCallback(async (eventType: EventType, fragmentId: string | null = null, payload: Record<string, unknown> = {}) => {
    if (!current) return
    const [deviceId, localUserId] = await Promise.all([getDeviceId(), getLocalUserId()])
    const event = createLearningEvent({ userId: localUserId, deviceId, eventType, contentId: current.contentId, contentVersion: current.version, fragmentId, payload })
    await saveEvent(event)
    await refresh()
    if (online && remoteAdapter) void runSync(true)
  }, [current, online, refresh, runSync])

  const openReader = async (quick = false) => {
    if (!current) return
    await record('STORY_STARTED', current.fragments[fragmentIndex]?.fragmentId ?? null, { mode: quick ? 'three-minute' : 'continue' })
    setView('reader')
  }

  const chooseContent = async (pack: ContentPack) => {
    const key = contentKey(pack.contentId, pack.version)
    await db.settings.put({ key: 'currentContent', value: key })
    const position = await db.settings.get(`position:${key}`)
    setCurrentKey(key)
    setFragmentIndex(typeof position?.value === 'number' ? position.value : 0)
    setNote(latestNote(events, pack.contentId, pack.version))
    setQuizChoice(null)
    setQuizSubmitted(false)
    await recordFor(pack, 'STORY_STARTED')
    setView('reader')
  }

  const recordFor = async (pack: ContentPack, eventType: EventType) => {
    const [deviceId, localUserId] = await Promise.all([getDeviceId(), getLocalUserId()])
    await saveEvent(createLearningEvent({ userId: localUserId, deviceId, eventType, contentId: pack.contentId, contentVersion: pack.version }))
    await refresh()
    if (online && remoteAdapter) void runSync(true)
  }

  const move = async (nextIndex: number) => {
    if (!current) return
    const fragment = current.fragments[fragmentIndex]
    if (!done.has(fragment.fragmentId)) await record('FRAGMENT_COMPLETED', fragment.fragmentId)
    const bounded = Math.max(0, Math.min(current.fragments.length - 1, nextIndex))
    await db.settings.put({ key: `position:${currentKey}`, value: bounded })
    setFragmentIndex(bounded)
    if (bounded >= 3 && !revealed) await record('CONCEPT_VIEWED', current.fragments[bounded].fragmentId)
    if (bounded === current.fragments.length - 1 && done.size >= current.fragments.length - 1) await record('STORY_COMPLETED', current.fragments[bounded].fragmentId)
  }

  const submitQuiz = async () => {
    if (!current || quizChoice === null || quizSubmitted) return
    setQuizSubmitted(true)
    await record('QUIZ_ANSWERED', current.fragments[6].fragmentId, { choice: quizChoice, correct: quizChoice === current.quiz.correctIndex })
  }

  const saveNote = async () => {
    const trimmed = note.trim()
    if (!trimmed) { setNotice('先写下一句话，再保存。'); return }
    if (trimmed.length > 500) { setNotice('一句话请控制在500字以内。'); return }
    await record('NOTE_SAVED', null, { text: trimmed })
    setNotice('这句话已安全保存在本机。')
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>, kind: 'content' | 'backup') => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      if (kind === 'content') await importContentText(text)
      else await importBackupText(text)
      await refresh()
      setNotice(kind === 'content' ? '内容包已导入。' : '学习备份已合并。')
    } catch (error) { setNotice(errorMessage(error)) }
  }

  const downloadBackup = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `微光学习备份-${shanghaiDate()}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const clearDevice = async () => {
    if (!window.confirm('只清除这台设备上的内容和记录。云端数据不会删除。确认继续吗？')) return
    await clearLocalData()
    for (const pack of sampleContents) await saveContent(pack)
    await refresh()
    setView('home')
    setNotice('本机数据已清除，示例故事已恢复。')
  }

  const login = async () => {
    if (!loginEmail.includes('@')) { setNotice('请输入有效邮箱。'); return }
    try {
      await signInWithSyncPassword(loginEmail, loginPassword)
      setLoginPassword('')
      setNotice('登录成功，正在同步云端数据。')
    }
    catch (error) { setNotice(errorMessage(error)) }
  }

  const sendSetupLink = async () => {
    try {
      await sendMagicLink(loginEmail)
      setNotice('一次性设置链接已发送。请在浏览器打开邮件链接，然后回到设置页创建同步密码。')
    } catch (error) { setNotice(errorMessage(error)) }
  }

  const saveSyncPassword = async () => {
    try {
      await updateSyncPassword(newPassword, confirmPassword)
      setNewPassword('')
      setConfirmPassword('')
      setNotice('同步密码设置成功。现在可在手机和电脑上直接登录。')
    } catch (error) { setNotice(errorMessage(error)) }
  }

  if (!current) return <main className="loading">正在整理今天的学习内容…</main>
  const fragment = current.fragments[fragmentIndex]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="返回今日首页">
          <span className="brand-mark">◒</span><span>微光</span>
        </button>
        <div className={`sync-pill ${syncLabel.includes('失败') || syncLabel === '部分同步' ? 'warning' : ''}`} title={`待上传${pendingCount}条`}>
          <span className="status-dot" />{syncLabel}
        </div>
      </header>

      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}
      {needRefresh && <div className="update-banner">新版本已经准备好。<button onClick={() => void updateServiceWorker(true)}>现在更新</button><button onClick={() => setNeedRefresh(false)}>稍后</button></div>}

      {view === 'home' && (
        <main className="page home-page">
          <section className="hero">
            <p className="date-line">{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
            <h1>{studiedToday ? '今天，已经点亮了一点。' : '今天，读一点就很好。'}</h1>
            <p className="hero-copy">不用赶进度。吃饭时、下班后，任何一次认真接触都算完成。</p>
            <div className="today-card">
              <div className="progress-orb" style={{ '--progress': `${Math.round(done.size / current.fragments.length * 360)}deg` } as React.CSSProperties}>
                <span>{done.size}<small>/ {current.fragments.length}</small></span>
              </div>
              <div className="today-copy">
                <span className="kicker">正在阅读</span>
                <h2>{revealed ? current.revealedTitle : current.hiddenTitle}</h2>
                <p>{revealed ? `${current.domain} · ${current.difficulty}` : `答案尚未揭晓 · 约${fragment.estimatedMinutes}分钟`}</p>
              </div>
              <button className="primary-action" onClick={() => void openReader(false)}>继续阅读 <span>→</span></button>
              <button className="quiet-action" onClick={() => void openReader(true)}>我现在只有3分钟</button>
            </div>
            <div className="completion-line"><span className={studiedToday ? 'check done' : 'check'}>{studiedToday ? '✓' : '○'}</span><span>{studiedToday ? '今日目标已完成' : '完成任意一个片段即可点亮今天'}</span><small>{formatTime(lastEvent?.occurredAt)}</small></div>
          </section>

          <section className="library">
            <div className="section-heading"><div><span className="kicker">故事架</span><h2>选择下一束微光</h2></div><span>{contents.length} 个概念</span></div>
            <div className="story-grid">
              {contents.map((pack, index) => {
                const key = contentKey(pack.contentId, pack.version)
                const packRevealed = events.some((event) => event.contentId === pack.contentId && event.contentVersion === pack.version && event.eventType === 'CONCEPT_VIEWED')
                return <button className={`story-card ${key === currentKey ? 'active' : ''}`} key={key} onClick={() => void chooseContent(pack)}>
                  <span className="story-number">0{index + 1}</span>
                  <span className="story-meta">{packRevealed ? pack.domain : '未知领域'} · {pack.difficulty}</span>
                  <strong>{packRevealed ? pack.revealedTitle : pack.hiddenTitle}</strong>
                  <span className="story-foot">{pack.estimatedMinutes}分钟，分7次读完 <b>→</b></span>
                </button>
              })}
            </div>
          </section>
        </main>
      )}

      {view === 'reader' && (
        <main className="page reader-page">
          <button className="back-link" onClick={() => setView('home')}>← 暂停并返回</button>
          <div className="reader-progress" aria-label={`第${fragmentIndex + 1}段，共${current.fragments.length}段`}>
            {current.fragments.map((item, index) => <span key={item.fragmentId} className={index <= fragmentIndex ? 'filled' : ''} />)}
          </div>
          <article className="paper">
            <p className="eyebrow">{fragment.eyebrow}</p>
            <h1>{fragment.title}</h1>
            <p className="reading-time">大约 {fragment.estimatedMinutes} 分钟</p>
            <div className="story-body">{fragment.body}</div>

            {fragment.kind === 'explanation' && <ConceptDetails pack={current} />}
            {fragment.kind === 'mapping' && <MappingDetails pack={current} note={note} setNote={setNote} saveNote={saveNote} />}
            {fragment.kind === 'quiz' && <Quiz pack={current} choice={quizChoice} setChoice={setQuizChoice} submitted={quizSubmitted} submit={submitQuiz} />}

            <div className="reader-actions">
              <button className="secondary-button" disabled={fragmentIndex === 0} onClick={() => void move(fragmentIndex - 1)}>上一段</button>
              {fragmentIndex < current.fragments.length - 1
                ? <button className="primary-button" onClick={() => void move(fragmentIndex + 1)}>读完这一段 <span>→</span></button>
                : <button className="primary-button" onClick={() => { void move(fragmentIndex); setView('home') }}>完成并回到今天</button>}
            </div>
          </article>
        </main>
      )}

      {view === 'settings' && (
        <main className="page settings-page">
          <p className="kicker">设置</p><h1>让数据跟着你，而不是困住你</h1>
          <section className="settings-card">
            <h2>跨设备同步</h2>
            {!cloudConfigured && <div className="soft-notice"><strong>当前是本地模式</strong><span>手机和电脑的数据暂不互通。配置云端后，同一账户会自动合并学习事件。</span></div>}
            {cloudConfigured && !userEmail && <div className="login-stack">
              <div className="login-row"><input type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="唯一账号邮箱" aria-label="邮箱"/><input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="同步密码" aria-label="同步密码"/><button onClick={() => void login()}>登录并同步</button></div>
              <button className="text-button" onClick={() => void sendSetupLink()}>首次使用或忘记密码：发送一次性设置链接</button>
            </div>}
            {userEmail && <div className="login-stack">
              <div className="account-row"><span>已登录：{userEmail}</span><button onClick={() => void runSync()}>立即同步</button><button onClick={() => void signOut()}>退出</button></div>
              <div className="login-row"><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="设置新的同步密码（至少12位）" aria-label="新的同步密码"/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入同步密码" aria-label="确认同步密码"/><button onClick={() => void saveSyncPassword()}>保存同步密码</button></div>
            </div>}
            <p className="microcopy">状态：{syncLabel} · 待上传 {pendingCount} 条 · 最后成功同步：{lastSyncedAt ? formatTime(lastSyncedAt) : '尚未完成'}。</p>
            {lastSyncError && <p className="microcopy warning-copy">最近错误：{lastSyncError}</p>}
            <p className="microcopy">首次使用时通过邮件链接进入网页并设置同步密码；以后手机和电脑都可直接登录。未登录或云端不可用时，所有操作仍会保存在本机；PWA完全关闭后不保证后台同步。</p>
          </section>
          <section className="settings-card">
            <h2>阅读与外观</h2>
            <div className="setting-line"><span>阅读主题</span><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '切换为深色' : '切换为浅色'}</button></div>
            <div className="setting-line"><span>安装到桌面</span><span className="muted">使用浏览器菜单中的“安装应用”或“添加到主屏幕”</span></div>
          </section>
          <section className="settings-card">
            <h2>内容与备份</h2>
            <div className="button-row">
              <button onClick={() => importRef.current?.click()}>导入内容包</button>
              <button onClick={() => backupRef.current?.click()}>导入学习备份</button>
              <button onClick={() => void downloadBackup()}>导出全部数据</button>
            </div>
            <input hidden ref={importRef} type="file" accept="application/json,.json" onChange={(event) => void importFile(event, 'content')} />
            <input hidden ref={backupRef} type="file" accept="application/json,.json" onChange={(event) => void importFile(event, 'backup')} />
            <p className="microcopy">导出文件不包含登录令牌和密钥，可用于换设备或恢复数据。</p>
          </section>
          <section className="settings-card privacy-card">
            <h2>隐私边界</h2>
            <p>请勿填写公司机密、未公开参数或客户敏感信息。公开专利资料与企业内部研发数据不是一回事。</p>
            <button className="danger-button" onClick={() => void clearDevice()}>只清除这台设备的数据</button>
          </section>
        </main>
      )}

      <nav className="bottom-nav" aria-label="主要导航">
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><span>⌂</span>今天</button>
        <button className={view === 'reader' ? 'active' : ''} onClick={() => void openReader(false)}><span>◫</span>阅读</button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><span>◌</span>设置</button>
      </nav>
    </div>
  )
}

function ConceptDetails({ pack }: { pack: ContentPack }) {
  return <div className="concept-panel">
    <h2>{pack.revealedTitle}</h2>
    <p>{pack.conceptExplanation}</p>
    <h3>适用边界</h3><ul>{pack.applicableBoundaries.map((item) => <li key={item}>{item}</li>)}</ul>
    <h3>常见误解</h3><ul>{pack.commonMisunderstandings.map((item) => <li key={item}>{item}</li>)}</ul>
  </div>
}

function MappingDetails({ pack, note, setNote, saveNote }: { pack: ContentPack; note: string; setNote: (value: string) => void; saveNote: () => Promise<void> }) {
  return <div className="concept-panel mapping-panel">
    <h2>寓言里的对应关系</h2>
    <dl>{pack.metaphorMappings.map((item) => <div key={item.metaphor}><dt>{item.metaphor}</dt><dd>{item.meaning}</dd></div>)}</dl>
    <h3>带回研发现场</h3><p>{pack.engineeringTransfer}</p>
    <h3>我用一句话理解</h3>
    <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="写给明天的自己……" />
    <p className="confidentiality">请勿填写公司机密、未公开参数或客户敏感信息。</p>
    <button className="secondary-button" onClick={() => void saveNote()}>保存这句话</button>
  </div>
}

function Quiz({ pack, choice, setChoice, submitted, submit }: { pack: ContentPack; choice: number | null; setChoice: (choice: number) => void; submitted: boolean; submit: () => Promise<void> }) {
  return <div className="quiz-panel">
    <h2>{pack.quiz.question}</h2>
    <div className="quiz-options">{pack.quiz.options.map((option, index) => <button key={option} disabled={submitted} className={`${choice === index ? 'selected' : ''} ${submitted && index === pack.quiz.correctIndex ? 'correct' : ''}`} onClick={() => setChoice(index)}>{String.fromCharCode(65 + index)}. {option}</button>)}</div>
    {!submitted && <button className="primary-button" disabled={choice === null} onClick={() => void submit()}>提交答案</button>}
    {submitted && <div className="quiz-result"><strong>{choice === pack.quiz.correctIndex ? '理解得很准确。' : '这次先记住区别。'}</strong><p>{pack.quiz.explanation}</p></div>}
    <div className="sources"><h3>资料来源</h3>{pack.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<small>{source.publisher} · {source.sourceType}</small></a>)}</div>
  </div>
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const yes = () => setOnline(true); const no = () => setOnline(false)
    window.addEventListener('online', yes); window.addEventListener('offline', no)
    return () => { window.removeEventListener('online', yes); window.removeEventListener('offline', no) }
  }, [])
  return online
}
