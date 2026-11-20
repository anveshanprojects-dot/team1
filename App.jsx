import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowUpRight, Bell, Check, CheckCheck,
  CircleHelp, Copy, File, FileText, Image, ImagePlus, Info, LogOut, Menu, MessageCircle, MoreHorizontal, Pin,
  Mic, Paperclip, Plus, RefreshCw, Search, Send, Settings, Smile, Square, Trash2, UserRound, Users, X,
} from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const EMOJIS = ['😀', '😂', '🥰', '😍', '😊', '😎', '🥳', '😭', '👍', '❤️', '🔥', '🎉', '🙏', '✨', '👋', '🤔']
const GROUP_IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MESSAGE_PAGE_SIZE = 50
const AVATAR_MIN_SIZE = 640
const AVATAR_MAX_SIZE = 1080
const CROP_VIEW_SIZE = 280

function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file)
    const image = new window.Image()
    image.onload = () => {
      URL.revokeObjectURL(imageUrl)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl)
      reject(new Error('Could not read this image. Choose a valid JPG, PNG, or WebP file.'))
    }
    image.src = imageUrl
  })
}

function validateAvatarImage(file, notify) {
  if (!GROUP_IMAGE_EXTENSIONS[file.type] || file.size > 5 * 1024 * 1024) {
    notify('Choose a JPG, PNG, or WebP image smaller than 5 MB.')
    return false
  }
  return true
}

function getAvatarCropLayout(image, zoom, pan, size) {
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  const maxX = Math.max(0, (width - size) / 2)
  const maxY = Math.max(0, (height - size) / 2)
  const offsetX = Math.min(maxX, Math.max(-maxX, pan.x))
  const offsetY = Math.min(maxY, Math.max(-maxY, pan.y))
  return {
    scale,
    width,
    height,
    maxX,
    maxY,
    left: (size - width) / 2 + offsetX,
    top: (size - height) / 2 + offsetY,
  }
}

async function addSignedAttachmentUrls(rows, onError) {
  return Promise.all(rows.map(async (message) => {
    if (!message.attachment_url) return message
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(message.attachment_url, 3600)
    if (error) {
      onError(`Could not load attachment: ${error.message}`)
      return message
    }
    return { ...message, attachment_path: message.attachment_url, attachment_url: data.signedUrl }
  }))
}

function initials(name = '?') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatDuration(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function Avatar({ profile, size = 'normal', online = false, className = '' }) {
  return (
    <span className={`avatar avatar-${size} ${className}`.trim()}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" />
        : <span>{initials(profile?.full_name || profile?.username || 'U')}</span>}
      {online && <i className="online-dot" />}
    </span>
  )
}

function AvatarCropModal({ file, title, onCancel, onCrop }) {
  const [image, setImage] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [cropError, setCropError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cropping, setCropping] = useState(false)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    setImage(null)
    setLoadError('')
    setCropError('')
    setZoom(1)
    setPan({ x: 0, y: 0 })
    const imageUrl = URL.createObjectURL(file)
    const source = new window.Image()
    source.onload = () => setImage(source)
    source.onerror = () => setLoadError('Could not read this image. Choose a valid JPG, PNG, or WebP file.')
    source.src = imageUrl
    return () => {
      source.onload = null
      source.onerror = null
      URL.revokeObjectURL(imageUrl)
    }
  }, [file])

  const sourceSize = image ? Math.min(image.naturalWidth, image.naturalHeight) : 0
  const maxZoom = image ? Math.min(3, sourceSize / AVATAR_MIN_SIZE) : 1
  const imageIsLargeEnough = sourceSize >= AVATAR_MIN_SIZE

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const size = canvas.getBoundingClientRect().width || CROP_VIEW_SIZE
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size * pixelRatio)
    canvas.height = Math.round(size * pixelRatio)
    const context = canvas.getContext('2d')
    if (!context) {
      setCropError('Could not prepare the photo preview in this browser.')
      return
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, size, size)
    const layout = getAvatarCropLayout(image, zoom, pan, size)
    context.drawImage(image, layout.left, layout.top, layout.width, layout.height)
  }, [image, pan, zoom])

  useEffect(() => {
    drawPreview()
    window.addEventListener('resize', drawPreview)
    return () => window.removeEventListener('resize', drawPreview)
  }, [drawPreview])

  function startDragging(event) {
    if (!image) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
  }

  function dragImage(event) {
    const drag = dragRef.current
    if (!image || !drag || drag.pointerId !== event.pointerId) return
    const size = canvasRef.current?.getBoundingClientRect().width || CROP_VIEW_SIZE
    const layout = getAvatarCropLayout(image, zoom, { x: 0, y: 0 }, size)
    setPan({
      x: Math.min(layout.maxX, Math.max(-layout.maxX, drag.panX + event.clientX - drag.startX)),
      y: Math.min(layout.maxY, Math.max(-layout.maxY, drag.panY + event.clientY - drag.startY)),
    })
  }

  async function applyCrop() {
    if (!image || !imageIsLargeEnough || cropping) return
    setCropping(true)
    setCropError('')
    try {
      const size = canvasRef.current?.getBoundingClientRect().width || CROP_VIEW_SIZE
      const layout = getAvatarCropLayout(image, zoom, pan, size)
      const sourceCropSize = size / layout.scale
      const outputSize = Math.min(AVATAR_MAX_SIZE, Math.floor(sourceCropSize + 0.01))
      if (outputSize < AVATAR_MIN_SIZE) throw new Error('Zoom out or choose a larger image to keep the crop at least 640 × 640 pixels.')
      const sourceX = Math.min(image.naturalWidth - sourceCropSize, Math.max(0, -layout.left / layout.scale))
      const sourceY = Math.min(image.naturalHeight - sourceCropSize, Math.max(0, -layout.top / layout.scale))
      const output = document.createElement('canvas')
      output.width = outputSize
      output.height = outputSize
      const context = output.getContext('2d')
      if (!context) throw new Error('Could not crop the photo in this browser.')
      context.drawImage(image, sourceX, sourceY, sourceCropSize, sourceCropSize, 0, 0, outputSize, outputSize)
      const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/webp', 0.92))
      if (!blob) throw new Error('Could not create the cropped photo.')
      if (blob.size > 5 * 1024 * 1024) throw new Error('The cropped photo must be smaller than 5 MB.')
      const extension = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png'
      onCrop(new window.File([blob], `avatar-${Date.now()}.${extension}`, { type: blob.type }))
    } catch (error) {
      setCropError(error.message || 'Could not crop this photo.')
    } finally {
      setCropping(false)
    }
  }

  return <div className="modal-backdrop image-crop-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="image-crop-modal" role="dialog" aria-modal="true" aria-labelledby="image-crop-title">
      <header className="modal-header">
        <div><span className="eyebrow">PHOTO ADJUSTMENT</span><h2 id="image-crop-title">{title}</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancel photo adjustment"><X size={18} /></button>
      </header>
      <p className="image-crop-instructions">Drag the photo inside the circle, then adjust the zoom.</p>
      <div className="image-crop-preview">
        {image
          ? <canvas
            ref={canvasRef}
            className="image-crop-canvas"
            aria-label="Circular photo crop preview. Drag to reposition."
            onPointerDown={startDragging}
            onPointerMove={dragImage}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
          />
          : <p role="status">{loadError || 'Loading photo…'}</p>}
      </div>
      {image && !imageIsLargeEnough && <p className="image-crop-error" role="alert">Use an image at least 640 pixels on its shortest side.</p>}
      {image && <label className="image-crop-zoom">
        <span>Zoom</span>
        <input type="range" min="1" max={Math.max(1, maxZoom)} step="0.01" value={Math.min(zoom, maxZoom)} disabled={maxZoom <= 1 || !imageIsLargeEnough} onChange={(event) => setZoom(Number(event.target.value))} />
        <output>{Math.round(zoom * 100)}%</output>
      </label>}
      {cropError && <p className="image-crop-error" role="alert">{cropError}</p>}
      <div className="modal-actions">
        <button type="button" className="subtle-button" onClick={onCancel} disabled={cropping}>Cancel</button>
        <button type="button" className="primary-button" onClick={applyCrop} disabled={!image || !imageIsLargeEnough || cropping}>{cropping ? 'Cropping…' : 'Use this photo'}</button>
      </div>
    </section>
  </div>
}

function GroupAvatar({ conversation, size = 'normal' }) {
  const sizeClass = size === 'head' ? 'group-avatar-head' : size === 'xl' ? 'group-avatar-xl' : ''
  return <span className={`group-avatar ${sizeClass}`}>
    {conversation?.avatar_url
      ? <img src={conversation.avatar_url} alt="" loading="lazy" decoding="async" />
      : <Users size={size === 'xl' ? 25 : size === 'head' ? 18 : 19} />}
  </span>
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '' })
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'forgot') {
        const { error: requestError } = await supabase.auth.resetPasswordForEmail(form.email, {
          redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
        })
        if (requestError) throw requestError
        setMessage('Password reset instructions are on their way to your email.')
      } else if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: { data: {
            full_name: form.fullName.trim(),
            username: form.username.trim().replace(/^@/, '').toLowerCase(),
          }, emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
        })
        if (signUpError) throw signUpError
        if (data.session) {
          const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
          if (signOutError) throw signOutError
        }
        setForm((current) => ({ ...current, password: '' }))
        setMode('login')
        setMessage(data.session
          ? 'Your account was created successfully. Sign in to continue.'
          : 'Your account was created. Verify your email, then sign in to continue.')
      } else {
        const identifier = form.email.trim()
        const { data, error: loginError } = identifier.includes('@')
          ? await supabase.auth.signInWithPassword({ email: identifier, password: form.password })
          : await supabase.functions.invoke('username-login', { body: { username: identifier.replace(/^@/, '').toLowerCase(), password: form.password } })
        if (loginError) throw loginError
        if (identifier.includes('@')) onAuthenticated(data.session)
        else if (data?.session?.access_token && data?.session?.refresh_token) onAuthenticated((await supabase.auth.setSession(data.session)).data.session)
        else throw new Error(data?.error || 'Invalid username or password.')
      }
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function signInWithGoogle() {
    setBusy(true)
    setError('')
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
      })
      if (oauthError) throw oauthError
    } catch (oauthError) {
      setError(oauthError.message || 'Google sign-in is unavailable. Please try again.')
      setBusy(false)
    }
  }

  const heading = mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back'
  return (
    <main className="auth-page">
      <div className="auth-art">
        <div className="brand brand-light"><span className="brand-mark"><MessageCircle size={23} /></span>Anveshan Chat</div>
        <div className="art-copy">
          <div className="art-bubble bubble-one">The best conversations happen here. <span>✨</span></div>
          <div className="art-bubble bubble-two">Hey! Are we still on for coffee? <span>10:42</span></div>
          <div className="art-bubble bubble-three">Absolutely! ☕</div>
          <span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" />
          <h1>Closer, even<br />when you're apart.</h1>
          <p>Good conversations make every day a little brighter.</p>
        </div>
        <span className="auth-footnote">A little more human, a little more connected.</span>
      </div>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">{mode === 'register' ? 'GET STARTED' : mode === 'forgot' ? 'ACCOUNT RECOVERY' : 'YOUR PEOPLE ARE HERE'}</span>
          <h2>{heading}</h2>
          <p className="muted">{mode === 'register' ? 'Join Anveshan Chat and make room for more meaningful conversations.' : mode === 'forgot' ? 'We’ll send you a link to get back into your account.' : 'Sign in to pick up right where you left off.'}</p>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}
          <form onSubmit={submit} className="auth-form">
            {mode === 'register' && <>
              <label>Full name<input required autoComplete="name" value={form.fullName} onChange={update('fullName')} placeholder="Your name" maxLength="80" /></label>
              <label>Username<div className="input-prefix"><span>@</span><input required autoComplete="username" value={form.username} onChange={update('username')} placeholder="yourname" pattern="[A-Za-z0-9_]{3,24}" title="3–24 letters, numbers, or underscores" maxLength="24" /></div></label>
            </>}
            <label>{mode === 'login' ? 'Email or username' : 'Email address'}<input required type={mode === 'login' ? 'text' : 'email'} autoComplete="email" value={form.email} onChange={update('email')} placeholder={mode === 'login' ? 'you@example.com or @username' : 'you@example.com'} /></label>
            {mode !== 'forgot' && <label>Password<input required type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={update('password')} placeholder="At least 8 characters" minLength="8" /></label>}
            {mode === 'login' && <button className="text-button forgot-link" type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot password?</button>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : mode === 'forgot' ? 'Send reset link' : mode === 'register' ? 'Create account' : 'Sign in'} {!busy && <ArrowUpRight size={17} />}</button>
          </form>
          {mode === 'login' && <div className="auth-alternative">
            <span>or</span>
            <button type="button" className="google-signin-button" disabled={busy} onClick={signInWithGoogle}><b>G</b>Continue with Google</button>
          </div>}
          <p className="auth-switch">{mode === 'forgot' ? 'Remember your password?' : mode === 'register' ? 'Already have an account?' : 'New to Anveshan Chat?'} <button className="text-button" onClick={() => { setMode(mode === 'register' || mode === 'forgot' ? 'login' : 'register'); setError(''); setMessage('') }}>{mode === 'register' || mode === 'forgot' ? 'Sign in' : 'Create an account'}</button></p>
          {mode !== 'register' && mode !== 'forgot' && <div className="auth-security"><Info size={14} /> Your chats are private and secured with Supabase Auth.</div>}
        </div>
      </section>
    </main>
  )
}

function PasswordRecoveryScreen({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) setError(updateError.message)
    else setComplete(true)
  }

  return <main className="auth-page"><section className="auth-panel"><div className="auth-card">
    <span className="eyebrow">ACCOUNT RECOVERY</span>
    <h2>{complete ? 'Password updated' : 'Choose a new password'}</h2>
    <p className="muted">{complete ? 'Your account is secure with the new password.' : 'Enter a new password for your account.'}</p>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {complete
      ? <button className="primary-button auth-submit" onClick={onComplete}>Continue to Anveshan Chat <ArrowUpRight size={17} /></button>
      : <form onSubmit={submit} className="auth-form">
        <label>New password<input required type="password" autoComplete="new-password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm new password<input required type="password" autoComplete="new-password" minLength="8" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'} {!busy && <ArrowUpRight size={17} />}</button>
      </form>}
  </div></section></main>
}

function App() {
  const [session, setSession] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [databaseSetupRequired, setDatabaseSetupRequired] = useState(false)
  const [profile, setProfile] = useState(null)
  const [conversations, setConversations] = useState([])
  const [pinnedConversationIds, setPinnedConversationIds] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [activeStatus, setActiveStatus] = useState(null)
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [friendRequestBusy, setFriendRequestBusy] = useState(null)
  const [groupMemberBusy, setGroupMemberBusy] = useState(null)
  const [groupAvatarBusy, setGroupAvatarBusy] = useState(false)
  const [groupAvatarCropFile, setGroupAvatarCropFile] = useState(null)
  const [blockedUsers, setBlockedUsers] = useState([])
  const [notifications, setNotifications] = useState([])
  const [tab, setTab] = useState('chats')
  const [query, setQuery] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [profilePreview, setProfilePreview] = useState(null)
  const [searching, setSearching] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordedVoice, setRecordedVoice] = useState(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceSending, setVoiceSending] = useState(false)
  const [showSettings, setShowSettings] = useState(() => window.location.hash.startsWith('#settings'))
  const [showGroup, setShowGroup] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [pullRefreshProgress, setPullRefreshProgress] = useState(0)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(localStorage.getItem('chatter-notifications') === 'true')
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(localStorage.getItem('chatter-notification-sound') === 'true')
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [theme, setTheme] = useState(localStorage.getItem('chatter-theme') || 'light')
  const [typingUsers, setTypingUsers] = useState({})
  const bottomRef = useRef(null)
  const chatCanvasRef = useRef(null)
  const activeIdRef = useRef(activeId)
  const messagesRef = useRef(messages)
  const fileRef = useRef(null)
  const typingChannel = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const recordingTimerRef = useRef(null)
  const recordingStartedAtRef = useRef(0)
  const discardVoiceRecordingRef = useRef(false)
  const onlineUserIds = useRef(new Set())
  const notificationsEnabledRef = useRef(notificationsEnabled)
  const notificationSoundEnabledRef = useRef(notificationSoundEnabled)
  const notificationIdsRef = useRef(new Set())
  const audioContextRef = useRef(null)
  const groupAvatarInputRef = useRef(null)
  const pullGestureRef = useRef(null)

  useEffect(() => {
    if (!recordedVoice) { setVoicePreviewUrl(''); return }
    const previewUrl = URL.createObjectURL(recordedVoice)
    setVoicePreviewUrl(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [recordedVoice])

  useEffect(() => {
    if (recorderRef.current?.state === 'recording') discardVoiceRecording()
    setRecordedVoice(null)
  }, [activeId])

  activeIdRef.current = activeId
  messagesRef.current = messages
  useEffect(() => { notificationsEnabledRef.current = notificationsEnabled }, [notificationsEnabled])
  useEffect(() => { notificationSoundEnabledRef.current = notificationSoundEnabled }, [notificationSoundEnabled])

  const activeConversation = conversations.find((conversation) => conversation.id === activeId)
  const activeMember = activeConversation?.members?.find((member) => member.id !== session?.user?.id)
  const activeMemberIsFriend = Boolean(activeMember && friends.some((friend) => friend.id === activeMember.id))
  const activeMemberRequest = activeMember && friendRequests.find((request) =>
    (request.sender_id === session?.user?.id && request.receiver_id === activeMember.id) ||
    (request.sender_id === activeMember.id && request.receiver_id === session?.user?.id)
  )
  const profilePreviewIsFriend = Boolean(profilePreview && friends.some((friend) => friend.id === profilePreview.id))
  const profilePreviewRequest = profilePreview && friendRequests.find((request) =>
    (request.sender_id === session?.user?.id && request.receiver_id === profilePreview.id) ||
    (request.sender_id === profilePreview.id && request.receiver_id === session?.user?.id)
  )
  const latestMessageId = messages.at(-1)?.id
  const firstUnreadMessageId = messages.find((message) =>
    message.sender_id !== session?.user?.id &&
    !message.message_receipts?.some((receipt) => receipt.user_id === session?.user?.id && receipt.read_at)
  )?.id
  const activeTitle = activeConversation?.is_group ? activeConversation.name : activeMember?.full_name || activeMember?.username || 'Conversation'
  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const person = conversation.members?.find((member) => member.id !== session?.user?.id)
    const title = conversation.is_group ? conversation.name : person?.full_name || person?.username || ''
    return title.toLowerCase().includes(query.toLowerCase()) ||
      conversation.last_message?.content?.toLowerCase().includes(query.toLowerCase())
  }), [conversations, query, session?.user?.id])

  const notify = useCallback((text) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 3500)
  }, [])
  function openSettingsPage() {
    const settingsUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    settingsUrl.hash = 'settings'
    const settingsTab = window.open(settingsUrl.toString(), '_blank')
    if (!settingsTab) {
      notify('Your browser blocked the Settings tab. Allow pop-ups for Anveshan Chat and try again.')
      return
    }
    settingsTab.opener = null
  }

  function closeSettingsPage() {
    const chatUrl = new URL(window.location.href)
    chatUrl.hash = ''
    window.history.replaceState(null, '', `${chatUrl.pathname}${chatUrl.search}`)
    setShowSettings(false)
  }

  async function deleteNotification(notificationId) {
    const { data, error } = await supabase.from('notifications').delete()
      .eq('id', notificationId)
      .eq('user_id', session.user.id)
      .select('id')
    if (error) {
      notify(error.message)
      return
    }
    if (!data?.length) {
      notify('This notification is no longer available.')
      return
    }
    notificationIdsRef.current.delete(notificationId)
    setNotifications((current) => current.filter((item) => item.id !== notificationId))
  }

  async function clearNotifications() {
    if (!notifications.length || !window.confirm('Delete all your notifications? This cannot be undone.')) return
    const { data, error } = await supabase.from('notifications').delete()
      .eq('user_id', session.user.id)
      .select('id')
    if (error) {
      notify(error.message)
      return
    }
    const deletedIds = new Set((data || []).map((item) => item.id))
    deletedIds.forEach((id) => notificationIdsRef.current.delete(id))
    setNotifications((current) => current.filter((item) => !deletedIds.has(item.id)))
    notify(deletedIds.size ? 'Notifications deleted.' : 'There are no notifications to delete.')
  }

  const enableNotificationSound = useCallback(async () => {
    if (!window.AudioContext) {
      notify('Notification sounds are not supported in this browser.')
      return false
    }
    try {
      audioContextRef.current ||= new window.AudioContext()
      await audioContextRef.current.resume()
      return true
    } catch (error) {
      notify(`Could not enable notification sound: ${error.message}`)
      return false
    }
  }, [notify])

  const playNotificationSound = useCallback(async () => {
    const context = audioContextRef.current
    if (!notificationSoundEnabledRef.current || !context) return
    try {
      if (context.state !== 'running') await context.resume()
      if (context.state !== 'running') return
      const oscillator = context.createOscillator()
      const volume = context.createGain()
      const now = context.currentTime
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(740, now)
      volume.gain.setValueAtTime(0.001, now)
      volume.gain.exponentialRampToValueAtTime(0.035, now + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
      oscillator.connect(volume)
      volume.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.19)
    } catch (error) {
      notify(`Could not play notification sound: ${error.message}`)
    }
  }, [notify])

  useEffect(() => {
    if (!session?.user?.id) {
      setPinnedConversationIds([])
      return
    }
    try {
      const savedPins = JSON.parse(localStorage.getItem(`chatter-pinned-${session.user.id}`) || '[]')
      setPinnedConversationIds(Array.isArray(savedPins) ? savedPins.filter((id) => typeof id === 'string') : [])
    } catch (error) {
      notify(`Could not load pinned chats: ${error.message}`)
      setPinnedConversationIds([])
    }
  }, [session?.user?.id, notify])

  useEffect(() => {
    if (!supabase) { setInitializing(false); return }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) notify(error.message)
      setSession(data.session)
      setInitializing(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(nextSession)
      setInitializing(false)
    })
    return () => data.subscription.unsubscribe()
  }, [notify])

  const loadWorkspace = useCallback(async () => {
    if (!session?.user) return
    setDatabaseSetupRequired(false)
    const user = session.user
    const profileColumns = 'id,user_id,username,full_name,bio,avatar_url,discoverable,show_online_status,show_last_seen,created_at'
    const { data: ownProfile, error: profileError } = await supabase.from('profiles').select(profileColumns).eq('id', user.id).maybeSingle()
    if (profileError) {
      if (profileError.code === 'PGRST205') setDatabaseSetupRequired(true)
      else notify(profileError.message)
      return
    }
    if (!ownProfile) {
      const { data: created, error: createError } = await supabase.from('profiles').insert({
        id: user.id,
        full_name: user.user_metadata?.full_name || 'New user',
        username: user.user_metadata?.username || `user_${user.id.slice(0, 8)}`,
      }).select(profileColumns).single()
      if (createError) notify(createError.message)
      else setProfile(created)
    } else setProfile(ownProfile)

    const [{ data: memberRows, error: convError }, { data: summaryRows, error: summaryError }, { data: friendRows, error: friendError },
      { data: requestRows, error: requestError }, { data: notificationRows, error: notificationError },
      { data: blockedRows, error: blockedError }] = await Promise.all([
      supabase.from('conversation_members').select('conversation_id, conversations(id, name, description, avatar_url, is_group, created_by, updated_at, conversation_members(user_id, role, profiles(id, username, full_name, avatar_url, bio, show_online_status)))').eq('user_id', user.id),
      supabase.rpc('get_conversation_summaries'),
      supabase.from('friendships').select('user_id, friend_id, profiles!friendships_friend_id_fkey(id, username, full_name, avatar_url, bio, show_online_status)').eq('user_id', user.id),
      supabase.from('friend_requests')
        .select('id,sender_id,receiver_id,status,created_at,sender:profiles!friend_requests_sender_id_fkey(id,username,full_name,avatar_url),receiver:profiles!friend_requests_receiver_id_fkey(id,username,full_name,avatar_url)')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).neq('status', 'accepted'),
      supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(25),
      supabase.from('blocked_users').select('blocked_id').eq('blocker_id', user.id),
    ])
    if ([convError, friendError, requestError, notificationError, blockedError].some((error) => error?.code === 'PGRST205')) {
      setDatabaseSetupRequired(true)
      return
    }
    for (const loadError of [convError, friendError, requestError, notificationError, blockedError]) if (loadError) notify(loadError.message)
    let availableSummaries = summaryRows || []
    if (summaryError?.code === 'PGRST202') {
      const { data: legacyRows, error: legacyError } = await supabase.from('conversation_members')
        .select('conversation_id, last_read_at, conversations(id, messages(id, content, created_at, sender_id, deleted_at))')
        .eq('user_id', user.id)
      if (legacyError) notify(legacyError.message)
      else {
        availableSummaries = (legacyRows || []).map((row) => {
          const messages = (row.conversations?.messages || [])
            .filter((message) => !message.deleted_at)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
          const latest = messages.at(-1)
          return {
            conversation_id: row.conversation_id,
            last_message_id: latest?.id,
            last_message_content: latest?.content,
            last_message_created_at: latest?.created_at,
            last_message_sender_id: latest?.sender_id,
            unread_count: messages.filter((message) => message.sender_id !== user.id &&
              (!row.last_read_at || new Date(message.created_at) > new Date(row.last_read_at))).length,
          }
        })
        notify('Chat database migration is missing. Chats are loading in compatibility mode; apply the chat migration to restore optimized summaries and pinning.')
      }
    } else if (summaryError) notify(summaryError.message)
    const summariesById = new Map(availableSummaries.map((summary) => [summary.conversation_id, summary]))
    const seen = new Set()
    const normalized = (memberRows || []).flatMap((row) => {
      const conversation = row.conversations
      if (!conversation || seen.has(conversation.id)) return []
      seen.add(conversation.id)
      const members = (conversation.conversation_members || []).map((member) => member.profiles ? {
        ...member.profiles, role: member.role,
        is_online: member.profiles.show_online_status && onlineUserIds.current.has(member.profiles.id),
      } : null).filter(Boolean)
      const summary = summariesById.get(conversation.id)
      const lastMessage = summary?.last_message_id ? {
        id: summary.last_message_id,
        content: summary.last_message_content,
        created_at: summary.last_message_created_at,
        sender_id: summary.last_message_sender_id,
      } : null
      return [{ ...conversation, members, last_message: lastMessage, unread: Number(summary?.unread_count || 0) }]
    }).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    setConversations(normalized)
    setFriends((friendRows || []).map((row) => row.profiles && ({
      ...row.profiles, is_online: row.profiles.show_online_status && onlineUserIds.current.has(row.profiles.id),
    })).filter(Boolean))
    setFriendRequests(requestRows || [])
    setBlockedUsers((blockedRows || []).map((row) => row.blocked_id))
    const loadedNotifications = notificationRows || []
    notificationIdsRef.current = new Set(loadedNotifications.map((item) => item.id))
    setNotifications(loadedNotifications)
    setActiveId((current) => current && normalized.some((conversation) => conversation.id === current) ? current : null)
  }, [session, notify])

  useEffect(() => { if (session) loadWorkspace() }, [session, loadWorkspace])

  useEffect(() => {
    if (!session?.user || !supabase) return
    const channel = supabase.channel(`workspace-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
        if (!message?.conversation_id) return
        setConversations((current) => current.map((conversation) => {
          if (conversation.id !== message.conversation_id) return conversation
          const isIncoming = message.sender_id !== session.user.id
          const isOpen = activeIdRef.current === conversation.id
          return {
            ...conversation,
            updated_at: message.created_at,
            last_message: message,
            unread: isIncoming && !isOpen ? conversation.unread + 1 : conversation.unread,
          }
        }).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${session.user.id}` }, () => loadWorkspace())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `sender_id=eq.${session.user.id}` }, () => loadWorkspace())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, (payload) => {
        if (!payload.new?.id || notificationIdsRef.current.has(payload.new.id)) return
        notificationIdsRef.current.add(payload.new.id)
        setNotifications((current) => current.some((item) => item.id === payload.new.id)
          ? current
          : [payload.new, ...current].slice(0, 100))
        playNotificationSound()
        if (notificationsEnabledRef.current && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(payload.new.title || 'Anveshan Chat', {
            body: payload.new.body || 'You have a new update.',
            silent: true,
            tag: payload.new.id,
          })
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnectionStatus('connected')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnectionStatus('disconnected')
        else setConnectionStatus('connecting')
      })
    const presence = supabase.channel('online-presence', { config: { presence: { key: session.user.id } } })
    let heartbeatId
    presence.on('presence', { event: 'sync' }, () => {
      const onlineIds = Object.keys(presence.presenceState())
      onlineUserIds.current = new Set(onlineIds)
      setConversations((current) => current.map((conversation) => ({
        ...conversation,
        members: conversation.members?.map((member) => ({ ...member, is_online: member.show_online_status && (onlineIds.includes(member.id) || member.id === session.user.id) })),
      })))
      setFriends((current) => current.map((friend) => ({ ...friend, is_online: friend.show_online_status && onlineIds.includes(friend.id) })))
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const updatePresence = async () => {
          await presence.track({ online_at: new Date().toISOString() })
          const { error } = await supabase.from('profiles').update({ is_online: true, last_seen_at: new Date().toISOString() }).eq('id', session.user.id)
          if (error) notify(error.message)
        }
        await updatePresence()
        heartbeatId = window.setInterval(updatePresence, 60000)
      }
    })
    return () => {
      if (heartbeatId) window.clearInterval(heartbeatId)
      supabase.removeChannel(channel)
      supabase.removeChannel(presence)
      supabase.from('profiles').update({ is_online: false, last_seen_at: new Date().toISOString() }).eq('id', session.user.id)
        .then(({ error }) => { if (error) notify(error.message) })
    }
  }, [session, loadWorkspace, notify, playNotificationSound])

  useEffect(() => {
    if (tab !== 'notifications' || !session?.user) return
    const unread = notifications.filter((item) => !item.read_at).map((item) => item.id)
    if (!unread.length) return
    const readAt = new Date().toISOString()
    supabase.from('notifications').update({ read_at: readAt }).eq('user_id', session.user.id).is('read_at', null).in('id', unread)
      .then(({ error }) => {
        if (error) notify(error.message)
        else setNotifications((current) => current.map((item) => unread.includes(item.id) ? { ...item, read_at: readAt } : item))
      })
  }, [tab, session, notifications, notify])

  useEffect(() => {
    if (!activeId || !session?.user) { setMessages([]); setHasOlderMessages(false); setMessagesLoading(false); return }
    let alive = true
    setMessagesLoading(true)
    const pendingRefreshes = new Set()
    let refreshTimer
    let syncTimer
    let syncInProgress = false
    let syncErrorReported = false
    async function refreshRealtimeMessage(messageId) {
      if (!messageId || !alive) return
      const { data, error } = await supabase.from('messages')
        .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
        .eq('id', messageId).eq('conversation_id', activeId).is('deleted_at', null).maybeSingle()
      if (error) { notify(error.message); return }
      if (!alive) return
      if (!data) {
        setMessages((current) => current.filter((message) => message.id !== messageId))
        return
      }
      const [updatedMessage] = await addSignedAttachmentUrls([data], notify)
      setMessages((current) => {
        if (!current.some((message) => message.id === messageId)) {
          return [...current, updatedMessage].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
        }
        return current.map((message) => message.id === messageId ? updatedMessage : message)
      })
    }
    async function refreshRealtimeMessages(messageIds) {
      const ids = [...new Set(messageIds)].filter((id) => messagesRef.current.some((message) => message.id === id))
      if (!ids.length || !alive) return
      const { data, error } = await supabase.from('messages')
        .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
        .eq('conversation_id', activeId).is('deleted_at', null).in('id', ids)
      if (error) { notify(error.message); return }
      if (!alive) return
      const refreshed = await addSignedAttachmentUrls(data || [], notify)
      const refreshedById = new Map(refreshed.map((message) => [message.id, message]))
      setMessages((current) => current
        .filter((message) => !ids.includes(message.id) || refreshedById.has(message.id))
        .map((message) => refreshedById.get(message.id) || message))
    }
    function queueMessageRefresh(messageId) {
      if (!messageId || !messagesRef.current.some((message) => message.id === messageId)) return
      pendingRefreshes.add(messageId)
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        const ids = [...pendingRefreshes]
        pendingRefreshes.clear()
        refreshRealtimeMessages(ids)
      }, 120)
    }
    async function loadMessages() {
      const { data, error } = await supabase.from('messages')
        .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
        .eq('conversation_id', activeId).is('deleted_at', null)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE)
      if (error) {
        if (alive) setMessagesLoading(false)
        notify(error.message)
        return
      }
      const page = await addSignedAttachmentUrls(data || [], notify)
      if (alive) {
        setMessagesLoading(false)
        setHasOlderMessages(page.length === MESSAGE_PAGE_SIZE)
        setMessages((current) => {
          if (!current.length) return page.reverse()
          const byId = new Map(current.map((message) => [message.id, message]))
          page.forEach((message) => byId.set(message.id, message))
          return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
        })
      }
      if (!alive) return
      const { error: readError } = await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', activeId).eq('user_id', session.user.id)
      if (readError) notify(readError.message)
      else setConversations((current) => current.map((conversation) => conversation.id === activeId ? { ...conversation, unread: 0 } : conversation))
      const unreadIds = page.filter((message) => message.sender_id !== session.user.id &&
        !message.message_receipts?.some((receipt) => receipt.user_id === session.user.id && receipt.read_at)).map((message) => message.id)
      if (unreadIds.length) {
        const { error: receiptError } = await supabase.from('message_receipts').update({ read_at: new Date().toISOString() })
          .eq('user_id', session.user.id).is('read_at', null).in('message_id', unreadIds)
        if (receiptError) notify(receiptError.message)
      }
    }
    async function syncMissedMessages() {
      if (!alive || syncInProgress) return
      syncInProgress = true
      try {
        const latest = messagesRef.current.filter((message) => message.conversation_id === activeId).at(-1)
        let request = supabase.from('messages')
          .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
          .eq('conversation_id', activeId).is('deleted_at', null)
        if (latest) {
          request = request.or(`created_at.gt.${latest.created_at},and(created_at.eq.${latest.created_at},id.gt.${latest.id})`)
        }
        const { data, error } = await request
          .order('created_at', { ascending: Boolean(latest) })
          .order('id', { ascending: Boolean(latest) })
          .limit(MESSAGE_PAGE_SIZE)
        if (error) {
          if (!syncErrorReported) notify(`Could not sync new messages: ${error.message}`)
          syncErrorReported = true
          return
        }
        syncErrorReported = false
        if (!alive || !data?.length) return
        const newRows = latest ? data : data.slice().reverse()
        const hydrated = await addSignedAttachmentUrls(newRows, notify)
        if (!alive) return
        setMessages((current) => {
          const byId = new Map(current.map((message) => [message.id, message]))
          hydrated.forEach((message) => byId.set(message.id, message))
          return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
        })
        const lastMessage = hydrated.at(-1)
        if (lastMessage) {
          setConversations((current) => current.map((conversation) => conversation.id === activeId
            ? { ...conversation, last_message: lastMessage, updated_at: lastMessage.created_at, unread: 0 }
            : conversation))
        }
        const unreadIds = newRows.filter((message) => message.sender_id !== session.user.id &&
          !message.message_receipts?.some((receipt) => receipt.user_id === session.user.id && receipt.read_at))
          .map((message) => message.id)
        if (unreadIds.length) {
          const readAt = new Date().toISOString()
          const { error: memberError } = await supabase.from('conversation_members')
            .update({ last_read_at: readAt }).eq('conversation_id', activeId).eq('user_id', session.user.id)
          if (memberError) notify(memberError.message)
          const { error: receiptError } = await supabase.from('message_receipts').update({ read_at: readAt })
            .eq('user_id', session.user.id).is('read_at', null).in('message_id', unreadIds)
          if (receiptError) notify(receiptError.message)
        }
      } catch (error) {
        if (!syncErrorReported) notify(`Could not sync new messages: ${error.message}`)
        syncErrorReported = true
      } finally {
        syncInProgress = false
      }
    }
    setMessages([])
    setHasOlderMessages(false)
    loadMessages()
    syncTimer = window.setInterval(syncMissedMessages, 5000)
    const channel = supabase.channel(`messages-${activeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` }, (payload) => {
        refreshRealtimeMessage(payload.new?.id || payload.old?.id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        queueMessageRefresh(payload.new?.message_id || payload.old?.message_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, (payload) => {
        queueMessageRefresh(payload.new?.message_id || payload.old?.message_id)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnectionStatus('connected')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnectionStatus('disconnected')
        else setConnectionStatus('connecting')
      })
    typingChannel.current = supabase.channel(`typing-${activeId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        setTypingUsers((current) => ({ ...current, [payload.userId]: payload.isTyping }))
        window.setTimeout(() => setTypingUsers((current) => ({ ...current, [payload.userId]: false })), 2500)
      }).subscribe()
    return () => { alive = false; window.clearTimeout(refreshTimer); window.clearInterval(syncTimer); supabase.removeChannel(channel); if (typingChannel.current) supabase.removeChannel(typingChannel.current) }
  }, [activeId, session, notify])

  useEffect(() => {
    if (!activeMember?.id || activeConversation?.is_group) { setActiveStatus(null); return }
    let active = true
    supabase.rpc('get_profile_status', { other_user: activeMember.id }).then(({ data, error }) => {
      if (error) { notify(error.message); return }
      if (active) setActiveStatus(data?.[0] || null)
    })
    return () => { active = false }
  }, [activeMember?.id, activeConversation?.is_group, notify])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [latestMessageId, activeId])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('chatter-theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('chatter-notifications', String(notificationsEnabled)) }, [notificationsEnabled])
  useEffect(() => { localStorage.setItem('chatter-notification-sound', String(notificationSoundEnabled)) }, [notificationSoundEnabled])

  useEffect(() => {
    if (!session?.user || !activeId) return
    const timeout = window.setTimeout(() => {
      typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: session.user.id, isTyping: false } })
    }, 1400)
    return () => window.clearTimeout(timeout)
  }, [draft, session, activeId])

  useEffect(() => () => {
    discardVoiceRecordingRef.current = true
    window.clearInterval(recordingTimerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  async function searchUsers(event, searchValue = userSearch) {
    event.preventDefault()
    const value = searchValue.trim().replace(/^@/, '')
    if (!value) { setSearchResults([]); return }
    setSearching(true)
    const { data, error } = await supabase.rpc('search_profiles', { search_term: value })
    setSearching(false)
    if (error) notify(error.message)
    else setSearchResults((data || []).filter((person) => person.id !== session.user.id))
  }

  async function loadOlderMessages() {
    const oldestMessage = messages[0]
    if (!activeId || !oldestMessage || !hasOlderMessages || loadingOlderMessages) return
    const canvas = chatCanvasRef.current
    const previousHeight = canvas?.scrollHeight || 0
    const previousTop = canvas?.scrollTop || 0
    const conversationId = activeId
    setLoadingOlderMessages(true)
    try {
      const { data, error } = await supabase.from('messages')
        .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
        .eq('conversation_id', conversationId).is('deleted_at', null)
        .or(`created_at.lt.${oldestMessage.created_at},and(created_at.eq.${oldestMessage.created_at},id.lt.${oldestMessage.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE)
      if (error) { notify(error.message); return }
      if (conversationId !== activeId) return
      const olderPage = await addSignedAttachmentUrls(data || [], notify)
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]))
        olderPage.forEach((message) => byId.set(message.id, message))
        return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
      })
      setHasOlderMessages(olderPage.length === MESSAGE_PAGE_SIZE)
      requestAnimationFrame(() => {
        if (chatCanvasRef.current === canvas && canvas) {
          canvas.scrollTop = previousTop + canvas.scrollHeight - previousHeight
        }
      })
    } catch (error) {
      notify(`Could not load older messages: ${error.message}`)
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  async function copyMessage(message) {
    if (!navigator.clipboard?.writeText) {
      notify('Copying is not available in this browser.')
      return
    }
    try {
      await navigator.clipboard.writeText(message.content)
      notify('Message copied.')
    } catch (error) {
      notify(`Could not copy message: ${error.message}`)
    }
  }

  async function toggleMessagePin(message) {
    const { data: pinned, error } = await supabase.rpc('toggle_message_pin', { target_message: message.id })
    if (error) {
      notify(error.code === 'PGRST202'
        ? 'Apply the chat performance and message-pins SQL migration before using pins.'
        : error.message)
      return
    }
    setMessages((current) => current.map((item) => item.id === message.id
      ? { ...item, is_pinned: pinned, pinned_by: pinned ? session.user.id : null, pinned_at: pinned ? new Date().toISOString() : null }
      : item))
    notify(pinned ? 'Message pinned for everyone in this conversation.' : 'Message unpinned.')
  }

  async function searchConversation() {
    const term = window.prompt('Search in this conversation')
    if (!term?.trim() || !activeId) return
    const conversationId = activeId
    const safeTerm = term.trim().replace(/[\\%_]/g, '\\$&')
    const columns = '*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)'
    const { data: matches, error } = await supabase.from('messages')
      .select(columns).eq('conversation_id', conversationId).is('deleted_at', null)
      .ilike('content', `%${safeTerm}%`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
    if (error) { notify(error.message); return }
    const match = matches?.[0]
    if (!match) { notify('No matching messages were found.'); return }
    const date = match.created_at
    const beforeQuery = supabase.from('messages').select(columns)
      .eq('conversation_id', conversationId).is('deleted_at', null)
      .or(`created_at.lt.${date},and(created_at.eq.${date},id.lt.${match.id})`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(25)
    const afterQuery = supabase.from('messages').select(columns)
      .eq('conversation_id', conversationId).is('deleted_at', null)
      .or(`created_at.gt.${date},and(created_at.eq.${date},id.gt.${match.id})`)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(25)
    const [{ data: before, error: beforeError }, { data: after, error: afterError }] = await Promise.all([beforeQuery, afterQuery])
    if (beforeError || afterError) { notify(beforeError?.message || afterError.message); return }
    if (activeId !== conversationId) return
    const context = await addSignedAttachmentUrls([...(before || []).reverse(), match, ...(after || [])], notify)
    setMessages(context)
    setHasOlderMessages((before || []).length === 25)
    requestAnimationFrame(() => document.getElementById(`message-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  async function openDirect(profileToOpen) {
    const { data, error } = await supabase.rpc('get_or_create_dm', { other_user: profileToOpen.id })
    if (error) { notify(error.message); return }
    setTab('chats')
    setSearchResults([])
    setUserSearch('')
    await loadWorkspace()
    setActiveId(data)
  }

  async function sendFriendRequest(person) {
    const requestExists = friendRequests.some((request) =>
      (request.sender_id === session.user.id && request.receiver_id === person.id) ||
      (request.sender_id === person.id && request.receiver_id === session.user.id)
    )
    if (person.id === session.user.id || friends.some((friend) => friend.id === person.id) || requestExists) return

    setFriendRequestBusy(person.id)
    const { error } = await supabase.from('friend_requests').insert({
      sender_id: session.user.id,
      receiver_id: person.id,
    })
    if (error) {
      notify(error.code === '23505'
        ? 'A request already exists between these accounts.'
        : error.message)
      setFriendRequestBusy(null)
      return
    }
    notify(`Friend request sent to ${person.full_name}.`)
    await loadWorkspace()
    setFriendRequestBusy(null)
  }

  async function respondFriendRequest(request, accept) {
    setFriendRequestBusy(request.id)
    if (accept) {
      const { error } = await supabase.rpc('accept_friend_request', { request_id: request.id })
      if (error) {
        notify(error.message)
        setFriendRequestBusy(null)
        return
      }
      notify(`You and ${request.sender?.full_name || 'this person'} are now friends.`)
    } else {
      const { data, error } = await supabase.from('friend_requests')
        .update({ status: 'rejected' })
        .eq('id', request.id)
        .eq('receiver_id', session.user.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (error) {
        notify(error.message)
        setFriendRequestBusy(null)
        return
      }
      if (!data) {
        notify('This friend request is no longer available.')
        setFriendRequestBusy(null)
        return
      }
      notify('Friend request declined.')
    }
    await loadWorkspace()
    setFriendRequestBusy(null)
  }

  async function removeFriend(person) {
    if (!window.confirm(`Unfriend ${person.full_name}? They will be removed from both People lists. Your direct chat and its history will remain.`)) return
    const { error } = await supabase.rpc('remove_friend', { other_user: person.id })
    if (error) { notify(error.message); return }
    notify(`${person.full_name} was removed from your People list. Your chat remains available.`)
    await loadWorkspace()
  }

  async function deleteChat(conversation) {
    const message = conversation.is_group
      ? `Leave "${conversation.name}" and remove it from your chats?`
      : 'Remove this chat from your inbox? This only affects you; the other person keeps their chat history.'
    if (!window.confirm(message)) return

    const { error } = conversation.is_group
      ? await supabase.rpc('leave_group', { group_id: conversation.id })
      : await supabase.from('conversation_members').delete()
        .eq('conversation_id', conversation.id)
        .eq('user_id', session.user.id)
    if (error) { notify(error.message); return }

    setConversations((current) => current.filter((item) => item.id !== conversation.id))
    const nextPins = pinnedConversationIds.filter((id) => id !== conversation.id)
    setPinnedConversationIds(nextPins)
    let resultMessage = conversation.is_group
      ? 'You left the group.'
      : 'Chat removed from your inbox. The other person keeps their history.'
    try {
      localStorage.setItem(`chatter-pinned-${session.user.id}`, JSON.stringify(nextPins))
    } catch (storageError) {
      resultMessage += ` The chat pin could not be cleared: ${storageError.message}`
    }
    if (activeId === conversation.id) {
      setActiveId(null)
      setMessages([])
      setActiveStatus(null)
      setHasOlderMessages(false)
      setShowInfo(false)
    }
    notify(resultMessage)
  }

  async function createGroup(name, members, photoFile) {
    setBusy(true)
    const { data: conversation, error } = await supabase.from('conversations').insert({ name: name.trim(), is_group: true, created_by: session.user.id }).select().single()
    if (error) { notify(error.message); setBusy(false); return }
    const uniqueIds = [...new Set([session.user.id, ...members])]
    const { error: membersError } = await supabase.from('conversation_members').insert(uniqueIds.map((userId) => ({
      conversation_id: conversation.id, user_id: userId, role: userId === session.user.id ? 'admin' : 'member',
    })))
    setBusy(false)
    if (membersError) { notify(membersError.message); return }
    setShowGroup(false)
    await loadWorkspace()
    setActiveId(conversation.id)
    if (photoFile) await uploadGroupAvatar(photoFile, conversation)
    else notify('Your group is ready.')
  }

  async function blockUser(userId) {
    const { error } = await supabase.from('blocked_users').insert({ blocker_id: session.user.id, blocked_id: userId })
    if (error) { notify(error.message); return }
    notify('User blocked. You can manage blocked accounts in settings.')
    setActiveId(null)
    setShowInfo(false)
    await loadWorkspace()
  }

  async function unblockUser(userId) {
    const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', session.user.id).eq('blocked_id', userId)
    if (error) notify(error.message)
    else { notify('User unblocked.'); await loadWorkspace() }
  }

  async function addGroupMember(userId) {
    if (!activeConversation?.is_group || activeConversation.members.find((member) => member.id === session.user.id)?.role !== 'admin') {
      notify('Only group admins can add members.')
      return
    }
    setGroupMemberBusy(userId)
    const { error } = await supabase.from('conversation_members').insert({ conversation_id: activeId, user_id: userId, role: 'member' })
    if (error) notify(error.message)
    else { notify('Member added.'); await loadWorkspace() }
    setGroupMemberBusy(null)
  }

  async function uploadGroupAvatar(file, conversation = activeConversation) {
    if (!file || !conversation?.is_group) return false
    if (!validateAvatarImage(file, notify)) return false
    let dimensions
    try {
      dimensions = await getImageDimensions(file)
    } catch (error) {
      notify(error.message)
      return false
    }
    if (dimensions.width !== dimensions.height || dimensions.width < AVATAR_MIN_SIZE || dimensions.width > AVATAR_MAX_SIZE) {
      notify('Group photos must be square and between 640 × 640 and 1080 × 1080 pixels.')
      return false
    }
    const extension = GROUP_IMAGE_EXTENSIONS[file.type]
    const isAdmin = conversation.created_by === session.user.id ||
      conversation.members?.some((member) => member.id === session.user.id && member.role === 'admin')
    if (!isAdmin) {
      notify('Only group admins can change the group photo.')
      return false
    }
    setGroupAvatarBusy(true)
    const path = `${session.user.id}/groups/${conversation.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type })
    if (uploadError) {
      notify(uploadError.message)
      setGroupAvatarBusy(false)
      return false
    }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: updateError } = await supabase.from('conversations')
      .update({ avatar_url: publicUrl }).eq('id', conversation.id)
    if (updateError) {
      const { error: cleanupError } = await supabase.storage.from('avatars').remove([path])
      notify(cleanupError
        ? `${updateError.message} The uploaded photo could not be cleaned up: ${cleanupError.message}`
        : updateError.message)
      setGroupAvatarBusy(false)
      return false
    }
    setConversations((current) => current.map((item) =>
      item.id === conversation.id ? { ...item, avatar_url: publicUrl } : item
    ))
    setGroupAvatarBusy(false)
    notify('Group photo updated.')
    return true
  }

  function chooseGroupAvatar(file) {
    if (!file || !validateAvatarImage(file, notify)) return
    setGroupAvatarCropFile(file)
  }

  async function removeGroupMember(userId) {
    if (userId === session.user.id) {
      const { error } = await supabase.rpc('leave_group', { group_id: activeId })
      if (error) { notify(error.message); return }
      setActiveId(null)
      await loadWorkspace()
      notify('You left the group.')
      return
    }
    const { error } = await supabase.from('conversation_members').delete().eq('conversation_id', activeId).eq('user_id', userId)
    if (error) notify(error.message)
    else { notify('Member removed.'); await loadWorkspace() }
  }

  async function renameGroup(conversation) {
    if (conversation.members.find((member) => member.id === session.user.id)?.role !== 'admin') {
      notify('Only group admins can rename the group.')
      return
    }
    const name = window.prompt('Group name', conversation.name)
    if (!name?.trim()) return
    const { error } = await supabase.from('conversations').update({ name: name.trim() }).eq('id', conversation.id)
    if (error) notify(error.message)
    else { notify('Group name updated.'); await loadWorkspace() }
  }

  async function editGroupDescription(conversation) {
    if (conversation.members.find((member) => member.id === session.user.id)?.role !== 'admin') {
      notify('Only group admins can edit the description.')
      return
    }
    const description = window.prompt('Group description', conversation.description || '')
    if (description === null) return
    const { error } = await supabase.from('conversations').update({ description: description.trim().slice(0, 300) }).eq('id', conversation.id)
    if (error) notify(error.message)
    else { notify('Group description updated.'); await loadWorkspace() }
  }

  async function promoteGroupMember(userId) {
    if (activeConversation?.members.find((member) => member.id === session.user.id)?.role !== 'admin') {
      notify('Only group admins can change member roles.')
      return
    }
    const { error } = await supabase.from('conversation_members').update({ role: 'admin' })
      .eq('conversation_id', activeId).eq('user_id', userId)
    if (error) notify(error.message)
    else { notify('Group admin added.'); await loadWorkspace() }
  }

  async function deleteGroup(conversation) {
    if (conversation.created_by !== session.user.id ||
      conversation.members.find((member) => member.id === session.user.id)?.role !== 'admin') {
      notify('Only the group creator can delete this group.')
      return
    }
    if (!window.confirm(`Delete "${conversation.name}" and its messages for everyone?`)) return
    const { error } = await supabase.from('conversations').delete().eq('id', conversation.id)
    if (error) notify(error.message)
    else { setActiveId(null); setShowInfo(false); notify('Group deleted.'); await loadWorkspace() }
  }

  async function sendMessage(event) {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || !activeId || busy) return
    const conversationId = activeId
    const messageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const previousConversation = conversations.find((conversation) => conversation.id === conversationId)
    const optimisticMessage = {
      id: messageId,
      conversation_id: conversationId,
      sender_id: session.user.id,
      content,
      type: 'text',
      reply_to: replyTo?.id || null,
      created_at: createdAt,
      profiles: profile,
      message_reactions: [],
      message_receipts: [],
    }
    if (activeIdRef.current === conversationId) {
      setMessages((current) => [...current, optimisticMessage])
    }
    setConversations((current) => current.map((conversation) => conversation.id === conversationId
      ? { ...conversation, last_message: optimisticMessage, updated_at: createdAt }
      : conversation).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)))
    setBusy(true)
    try {
      const { error } = await supabase.from('messages').insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: session.user.id,
        content,
        type: 'text',
        reply_to: replyTo?.id || null,
        created_at: createdAt,
      })
      if (error) throw error
      setDraft((current) => current === content ? '' : current)
      setReplyTo(null)
      setShowEmoji(false)
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== messageId))
      setConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId || conversation.last_message?.id !== messageId) return conversation
        return {
          ...conversation,
          last_message: previousConversation?.last_message || null,
          updated_at: previousConversation?.updated_at || conversation.updated_at,
        }
      }))
      notify(error.message || 'Message could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadFile(file) {
    if (!file || !activeId) return false
    const uploadMimeType = file.type.split(';', 1)[0].trim().toLowerCase()
    const allowed = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'application/pdf', 'text/plain', 'text/csv',
    ]).has(uploadMimeType)
    if (!allowed) { notify('This file type is not supported.'); return false }
    if (file.size > 25 * 1024 * 1024) { notify('Files must be 25 MB or smaller.'); return false }
    setBusy(true)
    const path = `${session.user.id}/${activeId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const { error: storageError } = await supabase.storage.from('chat-files').upload(path, file, { upsert: false, contentType: uploadMimeType })
    if (storageError) { notify(storageError.message); setBusy(false); return false }
    const kind = uploadMimeType.startsWith('image/') ? 'image' : uploadMimeType.startsWith('video/') ? 'video' : uploadMimeType.startsWith('audio/') ? 'audio' : 'file'
    const { error } = await supabase.from('messages').insert({
      conversation_id: activeId, sender_id: session.user.id,
      content: file.name, type: kind, attachment_url: path,
    })
    setBusy(false)
    if (error) notify(error.message)
    else setShowAttach(false)
    return !error
  }

  function discardVoiceRecording() {
    discardVoiceRecordingRef.current = true
    window.clearInterval(recordingTimerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    else streamRef.current?.getTracks().forEach((track) => track.stop())
    setRecording(false)
    setRecordingSeconds(0)
  }

  async function toggleVoiceRecording() {
    if (recording) {
      recorderRef.current?.stop()
      setRecording(false)
      window.clearInterval(recordingTimerRef.current)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      notify('Voice recording is not supported in this browser.')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        const recordingType = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm'
        const extension = recordingType.includes('mp4') ? 'm4a' : recordingType.includes('ogg') ? 'ogg' : 'webm'
        const voiceNote = new window.File(chunks, `voice-message-${Date.now()}.${extension}`, { type: recordingType })
        if (!discardVoiceRecordingRef.current) {
          if (voiceNote.size) setRecordedVoice(voiceNote)
          else notify('No audio was captured. Check microphone permission and try again.')
        }
        discardVoiceRecordingRef.current = false
        setRecording(false)
        setRecordingSeconds(0)
        window.clearInterval(recordingTimerRef.current)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
      }
      streamRef.current = stream
      recorderRef.current = recorder
      discardVoiceRecordingRef.current = false
      recordingStartedAtRef.current = Date.now()
      recorder.start()
      setRecording(true)
      setRecordedVoice(null)
      setRecordingSeconds(0)
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
      }, 1000)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      window.clearInterval(recordingTimerRef.current)
      notify(error.message || 'Microphone access was not granted.')
    }
  }

  async function sendRecordedVoice() {
    if (!recordedVoice || voiceSending || busy) return
    setVoiceSending(true)
    try {
      const sent = await uploadFile(recordedVoice)
      if (sent) setRecordedVoice(null)
    } finally {
      setVoiceSending(false)
    }
  }

  async function reactTo(message, emoji) {
    const ownReaction = message.message_reactions?.find((reaction) => reaction.user_id === session.user.id)
    const result = ownReaction
      ? await supabase.from('message_reactions').update({ emoji }).eq('id', ownReaction.id)
      : await supabase.from('message_reactions').insert({ message_id: message.id, user_id: session.user.id, emoji })
    if (result.error) { notify(result.error.message); return }
    const { data, error } = await supabase.from('messages')
      .select('*, profiles:sender_id(id, username, full_name, avatar_url), message_reactions(id, user_id, emoji), message_receipts(user_id, read_at)')
      .eq('id', message.id).single()
    if (error) { notify(error.message); return }
    const [updatedMessage] = await addSignedAttachmentUrls([data], notify)
    setMessages((current) => current.map((item) => item.id === message.id ? updatedMessage : item))
  }

  async function deleteMessage(message) {
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), content: 'This message was deleted' }).eq('id', message.id)
    if (error) notify(error.message)
  }

  async function editMessage(message) {
    const edited = window.prompt('Edit message', message.content)
    if (!edited?.trim()) return
    const { error } = await supabase.from('messages').update({ content: edited.trim(), edited_at: new Date().toISOString() }).eq('id', message.id)
    if (error) notify(error.message)
  }

  async function forwardMessage(message) {
    const target = window.prompt(`Forward to a conversation. Enter a contact username:\n${friends.map((friend) => `@${friend.username}`).join(', ')}`)
    if (!target) return
    const person = friends.find((friend) => friend.username.toLowerCase() === target.replace(/^@/, '').toLowerCase())
    if (!person) { notify('That friend could not be found.'); return }
    const { data: conversationId, error: dmError } = await supabase.rpc('get_or_create_dm', { other_user: person.id })
    if (dmError) { notify(dmError.message); return }
    let attachmentPath = null
    if (message.attachment_path) {
      const { data: file, error: downloadError } = await supabase.storage.from('chat-files').download(message.attachment_path)
      if (downloadError) { notify(downloadError.message); return }
      const filename = message.attachment_path.split('/').at(-1)?.replace(/[^\w.-]/g, '_') || crypto.randomUUID()
      attachmentPath = `${session.user.id}/${conversationId}/${crypto.randomUUID()}-${filename}`
      const { error: uploadError } = await supabase.storage.from('chat-files').upload(attachmentPath, file, { upsert: false })
      if (uploadError) { notify(uploadError.message); return }
    }
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId, sender_id: session.user.id, content: message.content,
      type: message.type, attachment_url: attachmentPath, forwarded_from: message.id,
    })
    if (error) notify(error.message)
    else { notify(`Message forwarded to ${person.full_name}.`); loadWorkspace() }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) notify(error.message)
    else { setProfile(null); setConversations([]); setMessages([]) }
  }

  async function deleteAccount() {
    const confirmed = window.prompt('This permanently deletes your account and chats. Type DELETE to confirm.')
    if (confirmed !== 'DELETE') return
    const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: true } })
    if (error) { notify(error.message); return }
    await supabase.auth.signOut({ scope: 'local' })
    notify('Your account has been deleted.')
  }

  async function saveSettings(updates) {
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', session.user.id)
      .select('id,user_id,username,full_name,bio,avatar_url,discoverable,show_online_status,show_last_seen,created_at').single()
    if (error) { notify(error.message); return false }
    setProfile(data)
    await loadWorkspace()
    return true
  }

  const settingsProps = {
    profile,
    email: session?.user?.email,
    blockedUsers,
    onUnblock: unblockUser,
    onDeleteAccount: deleteAccount,
    onClose: closeSettingsPage,
    onSignOut: signOut,
    onSave: saveSettings,
    theme,
    setTheme,
    notify,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationSoundEnabled,
    setNotificationSoundEnabled,
    enableNotificationSound,
  }

  if (!supabase) return <div className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark"><MessageCircle size={23} /></span>Anveshan Chat</div><h1>Almost there.</h1><p>Add your Supabase project URL and anon key to a <code>.env</code> file to connect Anveshan Chat to its live backend.</p><pre>VITE_SUPABASE_URL=https://…supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=…</pre><p>Then run <code>npm run dev</code>. See <a href="./README.md">README.md</a> for database setup.</p></div></div>
  if (initializing) return <div className="loading-screen"><span className="spinner spinner-large" /><span>Getting things ready…</span></div>
  if (passwordRecovery) return <PasswordRecoveryScreen onComplete={() => setPasswordRecovery(false)} />
  if (!session) return <AuthScreen onAuthenticated={setSession} />
  if (databaseSetupRequired) return <div className="setup-screen"><div className="setup-card">
    <div className="brand"><span className="brand-mark"><MessageCircle size={23} /></span>Anveshan Chat</div>
    <h1>Connect your database.</h1>
    <p>Authentication is working, but Anveshan Chat’s database tables are missing from this Supabase project. Messaging and profiles need the schema installed first.</p>
    <ol className="database-setup-steps">
      <li>Open your Supabase project and go to <strong>SQL Editor</strong>.</li>
      <li>Open <code>supabase/schema.sql</code> in this project, copy its contents, and run them in SQL Editor.</li>
      <li>Return here and retry. The schema creates the tables, security policies, realtime setup, and storage buckets.</li>
    </ol>
    <div className="database-setup-actions">
      <button className="primary-button" onClick={loadWorkspace}>Retry database connection</button>
      <button className="subtle-button" onClick={signOut}>Sign out</button>
    </div>
    <p className="database-setup-note">Run the SQL with a Supabase project owner account. Never put a service-role key in the website.</p>
  </div></div>
  if (showSettings) return <SettingsModal {...settingsProps} standalone />

  const startTyping = () => typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: session.user.id, isTyping: true } })
  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unread, 0)
  const appClass = `app-shell ${activeConversation ? 'conversation-open' : ''}`
  const pinnedConversations = filteredConversations.filter((conversation) => pinnedConversationIds.includes(conversation.id))
  const recentConversations = filteredConversations.filter((conversation) => !pinnedConversationIds.includes(conversation.id))
  const groupConversations = filteredConversations.filter((conversation) => conversation.is_group)

  function togglePinnedConversation(conversationId) {
    const nextPins = pinnedConversationIds.includes(conversationId)
      ? pinnedConversationIds.filter((id) => id !== conversationId)
      : [conversationId, ...pinnedConversationIds]
    try {
      localStorage.setItem(`chatter-pinned-${session.user.id}`, JSON.stringify(nextPins))
      setPinnedConversationIds(nextPins)
    } catch (error) {
      notify(`Could not save pinned chats: ${error.message}`)
    }
  }

  function renderConversationRow(conversation) {
    const person = conversation.members?.find((member) => member.id !== session.user.id)
    const selected = activeId === conversation.id
    const isPinned = pinnedConversationIds.includes(conversation.id)
    return <div className="conversation-entry" key={conversation.id}>
      <button className={`conversation-row ${selected ? 'conversation-selected' : ''}`} onClick={() => { setActiveId(conversation.id); setShowMobileMenu(false) }}>
        {conversation.is_group
          ? <GroupAvatar conversation={conversation} />
          : <Avatar profile={person} online={person?.is_online} size="large" className="recent-chat-avatar" />}
        <span className="conversation-copy">
          <span className="conversation-title">{conversation.is_group ? conversation.name : person?.full_name || person?.username || 'Unknown user'}</span>
          <span className="conversation-preview">{conversation.last_message?.sender_id === session.user.id ? 'You: ' : ''}{conversation.last_message?.content || (conversation.is_group ? 'Group conversation' : 'Say hello 👋')}</span>
        </span>
        <span className="conversation-meta"><time>{formatTime(conversation.last_message?.created_at || conversation.updated_at)}</time>{conversation.unread > 0 && <i className="unread-count">{conversation.unread}</i>}</span>
      </button>
      <button type="button" className={`conversation-pin ${isPinned ? 'conversation-pin-active' : ''}`} aria-label={isPinned ? 'Unpin chat' : 'Pin chat'} aria-pressed={isPinned} title={isPinned ? 'Unpin chat' : 'Pin chat'} onClick={() => togglePinnedConversation(conversation.id)}>
        <Pin size={15} />
      </button>
      <button type="button" className="conversation-delete" aria-label={conversation.is_group ? 'Leave group and remove chat' : 'Delete chat for me'} title={conversation.is_group ? 'Leave group and remove chat' : 'Delete chat for me'} onClick={() => deleteChat(conversation)}>
        <Trash2 size={15} />
      </button>
    </div>
  }

  function handlePullTouchStart(event) {
    if (!window.matchMedia('(max-width: 700px)').matches || event.currentTarget.scrollTop > 0) return
    const touch = event.touches[0]
    if (touch) pullGestureRef.current = { startY: touch.clientY, target: event.currentTarget, progress: 0 }
  }

  function handlePullTouchMove(event) {
    const gesture = pullGestureRef.current
    if (!gesture || gesture.target !== event.currentTarget) return
    if (event.currentTarget.scrollTop > 0) {
      cancelPullGesture()
      return
    }
    const touch = event.touches[0]
    if (!touch) return
    const delta = touch.clientY - gesture.startY
    if (delta <= 0) {
      cancelPullGesture()
      return
    }
    const progress = Math.min(1, Math.max(0, delta / 72))
    gesture.progress = progress
    setPullRefreshProgress(Math.round(progress * 10) / 10)
  }

  function handlePullTouchEnd(event) {
    const gesture = pullGestureRef.current
    if (!gesture || gesture.target !== event.currentTarget) return
    pullGestureRef.current = null
    setPullRefreshProgress(0)
    if (gesture.progress < 1 || event.currentTarget.scrollTop > 0) return
    window.location.reload()
  }

  function cancelPullGesture() {
    pullGestureRef.current = null
    setPullRefreshProgress(0)
  }

  function renderPullRefreshIndicator() {
    const visible = pullRefreshProgress > 0
    const label = pullRefreshProgress >= 1 ? 'Release to reload' : 'Pull to reload'
    return <div className={`pull-refresh-indicator ${visible ? 'pull-refresh-visible' : ''}`} role="status" aria-live="polite">
      <RefreshCw size={14} style={{ transform: `rotate(${pullRefreshProgress * 180}deg)` }} />
      <span>{label}</span>
    </div>
  }

  return (
    <main className={appClass}>
      <aside className={`sidebar ${showMobileMenu ? 'mobile-menu-open' : ''}`}>
        <header className="sidebar-header">
          <div className="brand"><span className="brand-mark"><MessageCircle size={21} /></span>Anveshan Chat</div>
          <div className="header-actions">
            <button className="icon-button" aria-label="Notifications" onClick={() => setTab(tab === 'notifications' ? 'chats' : 'notifications')}><Bell size={18} />{notifications.some((item) => !item.read_at) && <i className="notification-dot" />}</button>
            <button className="icon-button" aria-label="Settings" onClick={openSettingsPage}><Settings size={18} /></button>
          </div>
        </header>
        <div className="workspace-switcher">
          <span className="workspace-mark">W</span>
          <span><strong>My workspace</strong><small>Team messaging</small></span>
        </div>
        <form className="search-box" onSubmit={(event) => { setTab('search'); setUserSearch(query); searchUsers(event, query) }}>
          <Search size={17} /><input placeholder="Search messages or people" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="clear-search" onClick={() => setQuery('')}><X size={14} /></button>}
        </form>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={tab === 'groups' ? 'nav-item selected' : 'nav-item'} onClick={() => setTab('groups')}><Users size={18} />Groups</button>
          <button className={tab === 'chats' ? 'nav-item selected' : 'nav-item'} onClick={() => setTab('chats')}><MessageCircle size={18} />Messages{unreadTotal > 0 && <span className="nav-badge">{unreadTotal}</span>}</button>
          <button className={tab === 'contacts' ? 'nav-item selected' : 'nav-item'} onClick={() => setTab('contacts')}><UserRound size={18} />People<span className="nav-count">{friends.length}</span></button>
        </nav>
        <div className="list-heading"><span>{tab === 'chats' ? 'CHATS' : tab === 'groups' ? 'GROUPS' : tab === 'contacts' ? 'PEOPLE' : tab === 'search' ? 'FIND TEAMMATES' : tab === 'notifications' ? 'RECENT ACTIVITY' : 'CHATS'}</span>{(tab === 'chats' || tab === 'groups') && <button className="icon-button small-icon" onClick={() => setShowGroup(true)} title="Create a group"><Plus size={17} /></button>}{tab === 'notifications' && notifications.length > 0 && <button className="icon-button small-icon notification-clear-button" onClick={clearNotifications} title="Delete all notifications" aria-label="Delete all notifications"><Trash2 size={15} /></button>}</div>
        <div className="sidebar-list" onTouchStart={handlePullTouchStart} onTouchMove={handlePullTouchMove} onTouchEnd={handlePullTouchEnd} onTouchCancel={cancelPullGesture}>
          {renderPullRefreshIndicator()}
          {tab === 'chats' && (filteredConversations.length ? <>
            {pinnedConversations.length > 0 && <section className="chat-list-section">
              <h3 className="chat-list-section-heading"><Pin size={13} />Pinned</h3>
              {pinnedConversations.map(renderConversationRow)}
            </section>}
            <section className="chat-list-section">
              <h3 className="chat-list-section-heading">Recent chats</h3>
              {recentConversations.length
                ? recentConversations.map(renderConversationRow)
                : <div className="pinned-only-note">All conversations are pinned.</div>}
            </section>
          </> : <div className="empty-sidebar"><div className="empty-icon"><MessageCircle size={20} /></div><strong>{query ? 'No conversations found' : 'A quiet inbox'}</strong><span>{query ? 'Try another search.' : 'Find someone and start chatting.'}</span><button className="text-button" onClick={() => setTab('search')}>Find people <ArrowUpRight size={14} /></button></div>)}
          {tab === 'groups' && (groupConversations.length
            ? groupConversations.map(renderConversationRow)
            : <div className="empty-sidebar"><div className="empty-icon"><Users size={20} /></div><strong>{query ? 'No groups found' : 'No groups yet'}</strong><span>{query ? 'Try another search.' : 'Create a group to bring your people together.'}</span><button className="text-button" onClick={() => setShowGroup(true)}>Create a group <Plus size={14} /></button></div>)}
          {tab === 'contacts' && <>
            {friendRequests.some((request) => request.status === 'pending' && request.receiver_id === session.user.id) && <section className="people-request-section">
              <h3 className="people-section-heading">Friend requests</h3>
              {friendRequests.filter((request) => request.status === 'pending' && request.receiver_id === session.user.id).map((request) => <div className="people-request-row" key={request.id}>
                <Avatar profile={request.sender} />
                <span className="contact-copy"><strong>{request.sender?.full_name || 'Anveshan user'}</strong><small>@{request.sender?.username || 'unknown'}</small></span>
                <div className="people-request-actions">
                  <button className="primary-button" disabled={Boolean(friendRequestBusy)} onClick={() => respondFriendRequest(request, true)}>{friendRequestBusy === request.id ? '…' : 'Accept'}</button>
                  <button className="subtle-button" disabled={Boolean(friendRequestBusy)} onClick={() => respondFriendRequest(request, false)}>Reject</button>
                </div>
              </div>)}
            </section>}
            {friendRequests.some((request) => request.status === 'pending' && request.sender_id === session.user.id) && <section className="people-request-section">
              <h3 className="people-section-heading">Sent requests</h3>
              {friendRequests.filter((request) => request.status === 'pending' && request.sender_id === session.user.id).map((request) => <div className="people-request-row" key={request.id}>
                <Avatar profile={request.receiver} />
                <span className="contact-copy"><strong>{request.receiver?.full_name || 'Anveshan user'}</strong><small>@{request.receiver?.username || 'unknown'} · Waiting for a response</small></span>
              </div>)}
            </section>}
            <section className="people-contact-section">
              <h3 className="people-section-heading">People</h3>
              {friends.length ? friends.map((person) => <div className="contact-row" key={person.id}>
                <button className="contact-open" onClick={() => openDirect(person)}><Avatar profile={person} online={person.is_online} /><span className="contact-copy"><strong>{person.full_name}</strong><small>@{person.username}</small></span><MessageCircle size={17} /></button>
                <button className="contact-remove" aria-label={`Unfriend ${person.full_name}`} title={`Unfriend ${person.full_name}`} onClick={() => removeFriend(person)}><X size={14} /><span>Unfriend</span></button>
              </div>) : <div className="empty-sidebar"><div className="empty-icon"><Users size={20} /></div><strong>Your circle starts here</strong><span>Find people by username or Anveshan ID.</span><button className="text-button" onClick={() => setTab('search')}>Find someone <ArrowUpRight size={14} /></button></div>}
            </section>
          </>}
          {tab === 'search' && <><form className="people-search" onSubmit={searchUsers}><Search size={17} /><input autoFocus value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Username or Anveshan ID" /><button className="primary-button search-submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>{searchResults.map((person) => {
            const isFriend = friends.some((friend) => friend.id === person.id)
            const request = friendRequests.find((item) =>
              (item.sender_id === session.user.id && item.receiver_id === person.id) ||
              (item.sender_id === person.id && item.receiver_id === session.user.id)
            )
            return <div className="search-result" key={person.id}>
              <Avatar profile={person} online={person.is_online} />
              <span className="contact-copy"><strong>{person.full_name}</strong><small>@{person.username} · {person.user_id} · {person.is_online ? 'Online' : person.last_seen_at ? `Seen ${formatTime(person.last_seen_at)}` : 'Offline'}</small></span>
              <div className="result-actions">
                <button className="subtle-button profile-view-button" onClick={() => setProfilePreview(person)}>View profile</button>
                <FriendshipActions
                  className="search-friendship-actions"
                  person={person}
                  isFriend={isFriend}
                  request={request}
                  currentUserId={session.user.id}
                  busy={friendRequestBusy}
                  onSend={sendFriendRequest}
                  onRespond={respondFriendRequest}
                  onUnfriend={removeFriend}
                />
                <button className="primary-button result-message" onClick={() => openDirect(person)}>Message</button>
              </div>
            </div>
          })}{!searching && userSearch && !searchResults.length && <div className="empty-sidebar"><strong>No one found</strong><span>Check the spelling or try their exact username or ID.</span></div>}<div className="search-hint"><Info size={14} />Search exact usernames or unique Anveshan IDs.</div></>}
          {tab === 'notifications' && (notifications.length ? notifications.map((notification) => <div className="activity-row" key={notification.id}><span className="activity-icon"><Bell size={15} /></span><span><strong>{notification.title || 'Anveshan Chat update'}</strong><small>{notification.body || notification.type}</small><small>{formatTime(notification.created_at)}</small></span><button className="icon-button notification-delete-button" onClick={() => deleteNotification(notification.id)} title="Delete notification" aria-label={`Delete notification: ${notification.title || notification.type}`}><Trash2 size={15} /></button></div>) : <div className="empty-sidebar"><div className="empty-icon"><Bell size={20} /></div><strong>Nothing new</strong><span>Your latest activity will appear here.</span></div>)}
        </div>
        <footer className="sidebar-footer">
          <div className={`footer-status connection-${connectionStatus}`} role="status" aria-live="polite"><i />{connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'disconnected' ? 'Reconnecting…' : 'Connecting…'}</div>
          <button className="footer-help" onClick={() => notify('Tip: search for a username or Anveshan ID to find friends.')}><CircleHelp size={15} /> Help & tips</button>
        </footer>
      </aside>

      <section className={`chat-area ${activeConversation ? 'chat-area-active' : ''}`}>
        {activeConversation ? <>
          <header className="chat-header">
            <button className="icon-button back-button" onClick={() => setActiveId(null)} aria-label="Back to conversations"><ArrowLeft size={19} /></button>
            {activeConversation.is_group ? <GroupAvatar conversation={activeConversation} size="head" /> : <Avatar profile={activeMember} online={activeMember?.is_online} />}
            <button className="chat-person" onClick={() => setShowInfo(!showInfo)}><strong>{activeTitle}</strong><small>{activeConversation.is_group ? `${activeConversation.members?.length || 0} members` : activeMember?.is_online ? 'Online now' : activeStatus?.last_seen_at ? `Last seen ${formatTime(activeStatus.last_seen_at)}` : 'Offline'}</small></button>
            <div className="chat-header-actions"><button className="icon-button" title="Search all messages in this conversation" aria-label="Search messages" onClick={searchConversation}><Search size={18} /></button><button className="icon-button" onClick={() => setShowInfo(!showInfo)} title="Conversation details"><MoreHorizontal size={19} /></button></div>
          </header>
          <div className="chat-canvas" ref={chatCanvasRef} onTouchStart={handlePullTouchStart} onTouchMove={handlePullTouchMove} onTouchEnd={handlePullTouchEnd} onTouchCancel={cancelPullGesture}>
            {renderPullRefreshIndicator()}
            {hasOlderMessages && <button className="load-older-button" type="button" onClick={loadOlderMessages} disabled={loadingOlderMessages}>{loadingOlderMessages ? 'Loading…' : 'Load older messages'}</button>}
            <div className="conversation-date"><span>CONVERSATION</span></div>
            {messagesLoading && <div className="message-skeleton-list" aria-label="Loading messages">
              {[0, 1, 2, 3].map((item) => <div key={item} className={`message-skeleton-row ${item % 2 ? 'message-skeleton-own' : ''}`}><span /></div>)}
            </div>}
            {!messagesLoading && messages.length === 0 && <div className="chat-empty"><span className="chat-empty-icon">{activeConversation.is_group ? <Users size={24} /> : <MessageCircle size={24} />}</span><strong>This is the start of something good.</strong><span>Say hello to {activeTitle}.</span></div>}
            {messages.map((message, index) => {
              const own = message.sender_id === session.user.id
              const previous = messages[index - 1]
              const grouped = previous?.sender_id === message.sender_id && new Date(message.created_at) - new Date(previous.created_at) < 300000
              const delivered = own && message.message_receipts?.some((receipt) => receipt.user_id !== session.user.id)
              const seen = own && message.message_receipts?.some((receipt) => receipt.user_id !== session.user.id && receipt.read_at)
              return <React.Fragment key={message.id}>
                {message.id === firstUnreadMessageId && <div className="unread-message-divider"><span>Unread messages</span></div>}
                <div className={`message-line ${own ? 'message-own' : ''} ${grouped ? 'message-grouped' : ''}`} id={`message-${message.id}`}>
                {!own && !grouped && <Avatar profile={message.profiles} size="tiny" className="message-avatar" />}
                {!own && grouped && <span className="avatar-spacer" />}
                <div className="message-content-wrap">
                  {!own && !grouped && <span className="message-sender">{message.profiles?.full_name || 'Member'}</span>}
                  {message.reply_to && <div className="reply-quote">{(() => {
                    const original = messages.find((item) => item.id === message.reply_to)
                    return original ? `Replying to ${original.profiles?.full_name || 'a message'}: ${original.content}` : 'Replying to an earlier message'
                  })()}</div>}
                  {message.is_pinned && <div className="message-pin-badge"><Pin size={12} /> Pinned for everyone</div>}
                  {message.type === 'image' && <a href={message.attachment_url} target="_blank" rel="noreferrer"><img className="message-image" src={message.attachment_url} alt={message.content} loading="lazy" decoding="async" /></a>}
                  {message.type === 'video' && <video className="message-video" src={message.attachment_url} controls preload="metadata" />}
                  {message.type === 'audio' && <audio src={message.attachment_url} controls />}
                  {message.type === 'file' && <a className="file-attachment" href={message.attachment_url} target="_blank" rel="noreferrer"><FileText size={20} /><span>{message.content}<small>Open attachment</small></span></a>}
                  {message.type === 'text' && <div className="message-bubble"><span>{message.content}</span>{message.edited_at && <small className="edited-label">edited</small>}</div>}
                  <div className="message-meta"><time>{formatTime(message.created_at)}</time>{own && (seen ? <CheckCheck size={14} className="seen-check" /> : delivered ? <CheckCheck size={14} /> : <Check size={14} />)}</div>
                  {message.message_reactions?.length > 0 && <div className="reaction-list">{message.message_reactions.map((reaction) => <button key={reaction.id} onClick={() => reactTo(message, reaction.emoji)}>{reaction.emoji}</button>)}</div>}
                  <div className="message-hover-actions">
                    <button title="Reply" aria-label="Reply" onClick={() => setReplyTo(message)}><MessageCircle size={14} /></button>
                    <button title="React" aria-label="React" onClick={() => reactTo(message, '❤️')}><Smile size={14} /></button>
                    <button title="Copy message" aria-label="Copy message" onClick={() => copyMessage(message)} disabled={!message.content}><Copy size={14} /></button>
                    <button title={message.is_pinned ? 'Unpin message' : 'Pin message'} aria-label={message.is_pinned ? 'Unpin message' : 'Pin message'} onClick={() => toggleMessagePin(message)}><Pin size={14} /></button>
                    <button title="Forward" aria-label="Forward" onClick={() => forwardMessage(message)}><ArrowUpRight size={14} /></button>
                    {own && <><button title="Edit" aria-label="Edit" onClick={() => editMessage(message)}><MoreHorizontal size={14} /></button><button title="Delete for everyone" aria-label="Delete for everyone" onClick={() => deleteMessage(message)}><X size={14} /></button></>}
                  </div>
                </div>
                </div>
              </React.Fragment>
            })}
            {Object.entries(typingUsers).some(([userId, isTyping]) => isTyping && userId !== session.user.id) && <div className="typing-indicator"><i /><i /><i /><span>{activeTitle} is typing</span></div>}
            <div ref={bottomRef} />
          </div>
          <form className="composer" onSubmit={sendMessage}>
            {recording
              ? <div className="voice-recording-controls" role="status" aria-live="polite">
                <span className="voice-recording-indicator"><i /><Mic size={17} /></span>
                <span className="voice-recording-copy"><strong>Recording voice message</strong><small>{formatDuration(recordingSeconds)}</small></span>
                <button type="button" className="subtle-button voice-cancel-button" onClick={discardVoiceRecording}><X size={15} />Cancel</button>
                <button type="button" className="primary-button voice-stop-button" onClick={toggleVoiceRecording} aria-label="Finish recording"><Square size={14} />Stop</button>
              </div>
              : recordedVoice
                ? <div className="voice-review-controls">
                  <span className="voice-review-icon"><Mic size={17} /></span>
                  <audio src={voicePreviewUrl} controls preload="metadata" aria-label="Preview voice message" />
                  <button type="button" className="subtle-button voice-cancel-button" disabled={voiceSending} onClick={() => setRecordedVoice(null)}><X size={15} />Discard</button>
                  <button type="button" className="primary-button voice-send-button" disabled={voiceSending || busy} onClick={sendRecordedVoice}><Send size={15} />{voiceSending ? 'Sending…' : 'Send voice'}</button>
                </div>
                : <>
                  {replyTo && <div className="replying-to"><span><strong>Replying to {replyTo.profiles?.full_name || 'yourself'}</strong><small>{replyTo.content}</small></span><button type="button" className="icon-button" onClick={() => setReplyTo(null)}><X size={16} /></button></div>}
                  {showEmoji && <div className="emoji-panel">{EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={() => setDraft((current) => current + emoji)}>{emoji}</button>)}</div>}
                  {showAttach && <div className="attach-panel"><button type="button" onClick={() => { fileRef.current.accept = 'image/*'; fileRef.current.click() }}><span className="attach-image"><Image size={17} /></span>Photo or video</button><button type="button" onClick={() => { fileRef.current.accept = '*/*'; fileRef.current.click() }}><span className="attach-file"><File size={17} /></span>Document</button></div>}
                  <input ref={fileRef} hidden type="file" onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = '' }} />
                  <button type="button" className={`composer-icon ${showAttach ? 'composer-active' : ''}`} onClick={() => { setShowAttach(!showAttach); setShowEmoji(false) }} title="Attach file"><Paperclip size={19} /></button>
                  <div className="composer-input"><input value={draft} onChange={(event) => { setDraft(event.target.value); startTyping() }} placeholder="Write a message..." aria-label="Write a message" /><button type="button" className="composer-icon emoji-button" onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false) }} title="Add emoji"><Smile size={19} /></button></div>
                  <button type="button" className="composer-icon voice-button" onClick={toggleVoiceRecording} title="Record voice message" aria-label="Record voice message"><Mic size={18} /></button>
                  <button className="send-button" disabled={!draft.trim() || busy} aria-label="Send message"><Send size={18} /></button>
                </>}
          </form>
        </> : <div className="welcome-panel">
          <header className="workspace-topbar">
            <button className="icon-button mobile-menu-button" onClick={() => setShowMobileMenu(true)} aria-label="Open workspace menu"><Menu size={19} /></button>
            <span>Workspace <b>/</b> <strong>Messages</strong></span>
            <span className="workspace-secure"><i />Private workspace</span>
          </header>
          <div className="welcome-content">
            <div className="welcome-illustration"><div className="welcome-ring ring-one" /><div className="welcome-ring ring-two" /><span className="welcome-message"><MessageCircle size={34} /></span><span className="float-dot dot-a">✦</span><span className="float-dot dot-b">✳</span><span className="float-dot dot-c">•</span></div>
            <div className="welcome-copy">
              <span className="eyebrow">YOUR TEAM, IN SYNC</span>
              <h1>Work moves forward<br />when everyone’s <em>in.</em></h1>
              <p>Bring your team’s conversations together. Start a direct message or create a group to keep work moving.</p>
              <div className="welcome-actions">
                <button className="primary-button welcome-cta" onClick={() => { setTab('search'); setShowMobileMenu(true) }}><Plus size={16} />Start a conversation</button>
                <button className="welcome-secondary" onClick={() => setShowGroup(true)}><Users size={16} />Create a group</button>
              </div>
              <div className="workspace-summary">
                <button onClick={() => setTab('chats')}><MessageCircle size={16} /><span><strong>{conversations.length}</strong><small>Conversations</small></span></button>
                <button onClick={() => setTab('contacts')}><Users size={16} /><span><strong>{friends.length}</strong><small>Team contacts</small></span></button>
              </div>
            </div>
          </div>
          <span className="welcome-tip"><span>✦</span> Your conversations are private to the people in each chat.</span>
        </div>}
      </section>
      {showInfo && activeConversation && <aside className="info-panel">
        <header><strong>Details</strong><button className="icon-button" onClick={() => setShowInfo(false)}><X size={18} /></button></header>
        <div className="info-person">
          {activeConversation.is_group ? <GroupAvatar conversation={activeConversation} size="xl" /> : <Avatar profile={activeMember} size="xl" online={activeMember?.is_online} />}
          <strong>{activeTitle}</strong>
          <span>{activeConversation.is_group ? `Group · ${activeConversation.members?.length || 0} members` : `@${activeMember?.username}`}</span>
          {activeConversation.is_group && activeConversation.members.some((member) => member.id === session.user.id && member.role === 'admin') && <>
            <input ref={groupAvatarInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseGroupAvatar(event.target.files?.[0]); event.target.value = '' }} />
            <button type="button" className="subtle-button group-photo-button" disabled={groupAvatarBusy} onClick={() => groupAvatarInputRef.current?.click()}><ImagePlus size={14} />{groupAvatarBusy ? 'Updating photo…' : activeConversation.avatar_url ? 'Change group photo' : 'Add group photo'}</button>
          </>}
          {!activeConversation.is_group && activeMember?.user_id && <>
            <small>Anveshan ID · {activeMember.user_id}</small>
            <small>{activeMember.is_online ? 'Online now' : activeStatus?.last_seen_at ? `Last seen ${formatTime(activeStatus.last_seen_at)}` : 'Offline'}</small>
          </>}
        </div>
        {activeConversation.is_group && <div className="info-members">
          <h4>MEMBERS</h4>
          {activeConversation.members?.map((member) => <div key={member.id}>
            <Avatar profile={member} size="small" online={member.is_online} />
            <span>{member.full_name}<small>{member.id === session.user.id ? 'You' : `@${member.username}`} {member.role === 'admin' ? '· Admin' : ''}</small></span>
            {activeConversation.members.find((item) => item.id === session.user.id)?.role === 'admin' && member.id !== session.user.id && <>
              <button className="text-button" onClick={() => promoteGroupMember(member.id)}>Make admin</button>
              <button className="text-button" onClick={() => removeGroupMember(member.id)}>Remove</button>
            </>}
          </div>)}
          {activeConversation.members.find((item) => item.id === session.user.id)?.role === 'admin' && <GroupAddMembers
            friends={friends.filter((friend) => !activeConversation.members.some((member) => member.id === friend.id))}
            busyId={groupMemberBusy}
            onAdd={addGroupMember}
          />}
        </div>}
        {activeConversation.is_group
          ? <div className="info-meta group-admin-actions">
            <p>{activeConversation.description || 'No group description yet.'}</p>
            <button className="subtle-button" onClick={() => renameGroup(activeConversation)}>Rename group</button>
            {activeConversation.members.find((item) => item.id === session.user.id)?.role === 'admin' && <button className="subtle-button" onClick={() => editGroupDescription(activeConversation)}>Edit description</button>}
            <button className="subtle-button" onClick={() => removeGroupMember(session.user.id)}>Leave group</button>
            {activeConversation.created_by === session.user.id && <button className="subtle-button danger-action" onClick={() => deleteGroup(activeConversation)}>Delete group</button>}
          </div>
          : <div className="info-meta">
            <span><Info size={16} />About</span>
            <p>{activeMember?.bio || 'Making room for good conversations.'}</p>
            {activeMember && <FriendshipActions
              className="people-detail-actions"
              person={activeMember}
              isFriend={activeMemberIsFriend}
              request={activeMemberRequest}
              currentUserId={session.user.id}
              busy={friendRequestBusy}
              onSend={sendFriendRequest}
              onRespond={respondFriendRequest}
              onUnfriend={removeFriend}
            />}
            <button className="subtle-button danger-action" onClick={() => blockUser(activeMember.id)}>Block user</button>
          </div>}
      </aside>}
      {profilePreview && <PublicProfileModal
        profile={profilePreview}
        isFriend={profilePreviewIsFriend}
        request={profilePreviewRequest}
        currentUserId={session.user.id}
        busy={friendRequestBusy}
        onSend={sendFriendRequest}
        onRespond={respondFriendRequest}
        onUnfriend={removeFriend}
        onClose={() => setProfilePreview(null)}
        onMessage={(person) => { setProfilePreview(null); openDirect(person) }}
      />}
      {showGroup && <GroupModal friends={friends} onClose={() => setShowGroup(false)} onCreate={createGroup} busy={busy} />}
      {groupAvatarCropFile && <AvatarCropModal
        file={groupAvatarCropFile}
        title="Adjust group photo"
        onCancel={() => setGroupAvatarCropFile(null)}
        onCrop={(croppedFile) => { setGroupAvatarCropFile(null); void uploadGroupAvatar(croppedFile) }}
      />}
      {toast && <div className="toast"><span className="toast-check"><Check size={14} /></span>{toast}</div>}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button onClick={() => { setTab('chats'); setActiveId(null); setShowMobileMenu(false) }} className={tab === 'chats' ? 'mobile-nav-selected' : ''}><MessageCircle size={19} /><span>Chats</span>{unreadTotal > 0 && <i className="mobile-nav-badge">{unreadTotal}</i>}</button>
        <button onClick={() => { setTab('contacts'); setActiveId(null); setShowMobileMenu(false) }} className={tab === 'contacts' ? 'mobile-nav-selected' : ''}><Users size={19} /><span>People</span></button>
        <button onClick={() => { setTab('groups'); setActiveId(null); setShowMobileMenu(false) }} className={tab === 'groups' ? 'mobile-nav-selected' : ''}><Users size={19} /><span>Groups</span></button>
        <button onClick={openSettingsPage}><Settings size={19} /><span>Settings</span></button>
      </nav>
    </main>
  )
}

function PublicProfileModal({ profile, isFriend, request, currentUserId, busy, onSend, onRespond, onUnfriend, onClose, onMessage }) {
  const status = profile.is_online
    ? 'Online now'
    : profile.last_seen_at
      ? `Last seen ${formatTime(profile.last_seen_at)}`
      : 'Offline'

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="profile-modal public-profile-modal" role="dialog" aria-modal="true" aria-labelledby="public-profile-title">
        <header className="modal-header">
          <div><h2 id="public-profile-title">Profile</h2><p>Public profile details</p></div>
          <button className="icon-button" aria-label="Close profile" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="public-profile-identity">
          <Avatar profile={profile} size="xl" online={profile.is_online} />
          <strong>{profile.full_name}</strong>
          <span>@{profile.username}</span>
          <small>{status}</small>
        </div>
        <div className="public-profile-details">
          <div><small>CHATTER ID</small><strong>{profile.user_id}</strong></div>
          <div><small>ABOUT</small><p>{profile.bio || 'This person has not added a bio yet.'}</p></div>
        </div>
        <FriendshipActions
          className="profile-friend-actions"
          person={profile}
          isFriend={isFriend}
          request={request}
          currentUserId={currentUserId}
          busy={busy}
          onSend={onSend}
          onRespond={onRespond}
          onUnfriend={onUnfriend}
        />
        <footer className="modal-actions">
          <button className="subtle-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => onMessage(profile)}><MessageCircle size={16} />Message</button>
        </footer>
      </section>
    </div>
  )
}

function FriendshipActions({ person, isFriend, request, currentUserId, busy, onSend, onRespond, onUnfriend, className = '' }) {
  const isBusy = busy === person.id || Boolean(request && busy === request.id)

  if (isFriend) {
    return <div className={`friendship-actions ${className}`}>
      <button className="subtle-button danger-action" disabled={isBusy} onClick={() => onUnfriend(person)}>
        {isBusy ? 'Working…' : 'Unfriend'}
      </button>
    </div>
  }

  if (request?.status === 'pending' && request.receiver_id === currentUserId) {
    return <div className={`friendship-actions ${className}`}>
      <button className="primary-button" disabled={isBusy} onClick={() => onRespond(request, true)}>{isBusy ? 'Working…' : 'Accept request'}</button>
      <button className="subtle-button" disabled={isBusy} onClick={() => onRespond(request, false)}>Reject</button>
    </div>
  }

  if (request?.status === 'pending') {
    return <div className={`friendship-actions ${className}`}>
      <button className="subtle-button" disabled>Request sent</button>
    </div>
  }

  if (request) {
    const status = request.status === 'rejected' ? 'Request declined' : 'Request unavailable'
    return <div className={`friendship-actions ${className}`}>
      <button className="subtle-button" disabled>{status}</button>
    </div>
  }

  return <div className={`friendship-actions ${className}`}>
    <button className="primary-button" disabled={isBusy} onClick={() => onSend(person)}>{isBusy ? 'Sending…' : 'Add friend'}</button>
  </div>
}

function GroupAddMembers({ friends, busyId, onAdd }) {
  const [query, setQuery] = useState('')
  const availableFriends = friends.filter((friend) =>
    `${friend.full_name} ${friend.username}`.toLowerCase().includes(query.trim().toLowerCase())
  )

  return <section className="group-add-members" aria-labelledby="group-add-members-title">
    <div className="group-add-members-heading">
      <h4 id="group-add-members-title">ADD MEMBERS</h4>
      <span>{friends.length} available</span>
    </div>
    {friends.length ? <>
      <label className="group-member-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a friend" aria-label="Find a friend to add" />
      </label>
      <div className="group-member-candidates">
        {availableFriends.length ? availableFriends.map((friend) => <div className="group-member-candidate" key={friend.id}>
          <Avatar profile={friend} size="small" online={friend.is_online} />
          <span><strong>{friend.full_name}</strong><small>@{friend.username}</small></span>
          <button type="button" className="subtle-button" disabled={Boolean(busyId)} onClick={() => onAdd(friend.id)}>
            <Plus size={13} />{busyId === friend.id ? 'Adding…' : 'Add'}
          </button>
        </div>) : <p className="group-member-empty">No friends match that search.</p>}
      </div>
    </> : <p className="group-member-empty">All your friends are already in this group.</p>}
  </section>
}

function SettingsModal({ profile, email, blockedUsers, onUnblock, onDeleteAccount, onClose, onSignOut, onSave, theme, setTheme, notify, notificationsEnabled, setNotificationsEnabled, notificationSoundEnabled, setNotificationSoundEnabled, enableNotificationSound, standalone = false }) {
  const [section, setSection] = useState(() => window.location.hash === '#settings/profile' ? 'profile' : 'privacy')
  const [form, setForm] = useState({
    discoverable: profile?.discoverable ?? true,
    show_online_status: profile?.show_online_status ?? true,
    show_last_seen: profile?.show_last_seen ?? true,
  })
  const [profileForm, setProfileForm] = useState({
    full_name: profile?.full_name || '',
    username: profile?.username || '',
    bio: profile?.bio || '',
  })
  const [saving, setSaving] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarCropFile, setAvatarCropFile] = useState(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [password, setPassword] = useState('')
  const avatarInput = useRef(null)

  useEffect(() => {
    setProfileForm({
      full_name: profile?.full_name || '',
      username: profile?.username || '',
      bio: profile?.bio || '',
    })
  }, [profile?.id, profile?.full_name, profile?.username, profile?.bio])

  async function savePrivacy(event) {
    event.preventDefault()
    setSaving(true)
    const success = await onSave(form)
    setSaving(false)
    if (success) notify('Privacy settings updated.')
  }

  async function saveProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    const success = await onSave({
      full_name: profileForm.full_name.trim(),
      username: profileForm.username.trim().replace(/^@/, '').toLowerCase(),
      bio: profileForm.bio.trim(),
    })
    setSavingProfile(false)
    if (success) notify('Profile updated.')
  }

  async function uploadAvatar(file) {
    if (!file || !profile?.id) return
    if (!validateAvatarImage(file, notify)) return
    setAvatarBusy(true)
    try {
      const { width, height } = await getImageDimensions(file)
      if (width !== height || width < 640 || width > 1080) {
        notify('Profile photos must be square and between 640 × 640 and 1080 × 1080 pixels.')
        return
      }
      const path = `${profile.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type })
      if (error) {
        notify(error.message)
        return
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const success = await onSave({ avatar_url: data.publicUrl })
      if (success) notify('Profile photo updated.')
    } catch (error) {
      notify(error.message || 'Could not validate this profile photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  function chooseAvatar(file) {
    if (file && validateAvatarImage(file, notify)) setAvatarCropFile(file)
  }

  async function updatePassword(event) {
    event.preventDefault()
    setChangingPassword(true)
    const { error } = await supabase.auth.updateUser({ password })
    setChangingPassword(false)
    if (error) notify(error.message)
    else { notify('Password updated.'); setPassword('') }
  }

  const sections = [
    { id: 'profile', title: 'Profile', icon: UserRound },
    { id: 'privacy', title: 'Privacy & visibility', icon: Users },
    { id: 'notifications', title: 'Notifications', icon: Bell },
    { id: 'appearance', title: 'Appearance', icon: MessageCircle },
    { id: 'security', title: 'Security', icon: Settings },
    { id: 'blocked', title: 'Blocked people', icon: X },
    { id: 'account', title: 'Account', icon: Info },
  ]
  const headings = {
    profile: ['Profile', 'Update your name, username, photo, and bio.'],
    privacy: ['Privacy & visibility', 'Control what other people can see.'],
    notifications: ['Notifications', 'Choose how Anveshan Chat keeps you in the loop.'],
    appearance: ['Appearance', 'Personalize how Anveshan Chat looks on this device.'],
    security: ['Security', 'Manage your password and sign-in security.'],
    blocked: ['Blocked people', 'Review the accounts you have blocked.'],
    account: ['Account', 'Account details and sign-in actions.'],
  }

  return <>
    <div className={`modal-backdrop ${standalone ? 'settings-page-backdrop' : ''}`} onMouseDown={(event) => { if (!standalone && event.target === event.currentTarget) onClose() }}>
    <section className="settings-window">
      <header className="settings-topbar">
        <div><span className="settings-app-mark"><Settings size={16} /></span><strong>Settings</strong><span className="settings-divider">/</span><span>{headings[section][0]}</span></div>
        <button className="icon-button" onClick={onClose} aria-label={standalone ? 'Back to chat' : 'Close settings'} title={standalone ? 'Back to chat' : 'Close settings'}>{standalone ? <ArrowLeft size={19} /> : <X size={19} />}</button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <span className="settings-nav-heading">PREFERENCES</span>
          {sections.map(({ id, title, icon: Icon }) => <button key={id} className={section === id ? 'settings-nav-item settings-nav-selected' : 'settings-nav-item'} onClick={() => setSection(id)}><Icon size={16} />{title}</button>)}
          <div className="settings-nav-account"><Avatar profile={profile} size="small" /><span><strong>{profile?.full_name}</strong><small>@{profile?.username}</small></span></div>
        </nav>
        <div className="settings-content">
          <div className="settings-section-heading"><h2>{headings[section][0]}</h2><p>{headings[section][1]}</p></div>
          {section === 'profile' && <div className="settings-options">
            <div className="profile-identity settings-profile-identity">
              <div className="settings-avatar-frame" role="img" aria-label="Profile photo">
                <Avatar profile={profile} size="xl" />
              </div>
              <div><h3>{profile?.full_name || 'Your name'}</h3><p>@{profile?.username || 'username'}</p><button className="subtle-button" type="button" disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>{avatarBusy ? 'Checking and uploading…' : 'Change photo'}</button><small className="profile-photo-guidance">Crop JPG, PNG, or WebP to a square · 640–1080 px</small></div>
              <input ref={avatarInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseAvatar(event.target.files?.[0]); event.target.value = '' }} />
            </div>
            <form className="settings-form profile-edit-form" onSubmit={saveProfile}>
              <label>Full name<input required value={profileForm.full_name} maxLength="80" onChange={(event) => setProfileForm({ ...profileForm, full_name: event.target.value })} /></label>
              <label>Username<div className="input-prefix"><span>@</span><input required pattern="[A-Za-z0-9_]{3,24}" maxLength="24" value={profileForm.username} onChange={(event) => setProfileForm({ ...profileForm, username: event.target.value })} /></div></label>
              <label>About<textarea rows="3" maxLength="160" value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} placeholder="A little about you..." /></label>
              <div className="profile-details">
                <div><span>CHATTER ID</span><strong>{profile?.user_id || '—'}</strong></div>
                <div><span>EMAIL ADDRESS</span><strong>{email || '—'}</strong></div>
                <div><span>MEMBER SINCE</span><strong>{profile?.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.created_at)) : '—'}</strong></div>
              </div>
              <div className="settings-save-row"><button className="primary-button" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button></div>
            </form>
          </div>}
          {section === 'privacy' && <form className="settings-options" onSubmit={savePrivacy}>
            <label className="setting-option"><span><strong>Profile discoverability</strong><small>Allow people to find you by username or Anveshan ID.</small></span><input type="checkbox" checked={form.discoverable} onChange={(event) => setForm({ ...form, discoverable: event.target.checked })} /></label>
            <label className="setting-option"><span><strong>Online status</strong><small>Show your teammates when you’re currently online.</small></span><input type="checkbox" checked={form.show_online_status} onChange={(event) => setForm({ ...form, show_online_status: event.target.checked })} /></label>
            <label className="setting-option"><span><strong>Last seen</strong><small>Show when you were last active to other people.</small></span><input type="checkbox" checked={form.show_last_seen} onChange={(event) => setForm({ ...form, show_last_seen: event.target.checked })} /></label>
            <div className="settings-save-row"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
          </form>}
          {section === 'notifications' && <div className="settings-options">
            <label className="setting-option"><span><strong>Browser notifications</strong><small>Show a notification when new activity arrives.</small></span><input type="checkbox" checked={notificationsEnabled} onChange={async (event) => {
              if (!event.target.checked) { setNotificationsEnabled(false); return }
              if (!('Notification' in window)) { notify('This browser does not support notifications.'); return }
              const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
              if (permission === 'granted') setNotificationsEnabled(true)
              else notify('Browser notification permission was not granted.')
            }} /></label>
            <label className="setting-option"><span><strong>Notification sound</strong><small>Play a short sound for new activity.</small></span><input type="checkbox" checked={notificationSoundEnabled} onChange={async (event) => {
              if (!event.target.checked) { setNotificationSoundEnabled(false); return }
              if (await enableNotificationSound()) setNotificationSoundEnabled(true)
            }} /></label>
            <div className="settings-info-card"><Bell size={17} /><span>Desktop notifications appear only while Anveshan Chat is open and browser permission is enabled.</span></div>
          </div>}
          {section === 'appearance' && <div className="settings-options">
            <div className="setting-option"><span><strong>Theme</strong><small>Choose the appearance used on this device.</small></span><div className="theme-choice"><button className={theme === 'light' ? 'theme-choice-selected' : ''} onClick={() => setTheme('light')}><span className="theme-preview theme-preview-light" />Light</button><button className={theme === 'dark' ? 'theme-choice-selected' : ''} onClick={() => setTheme('dark')}><span className="theme-preview theme-preview-dark" />Dark</button></div></div>
          </div>}
          {section === 'security' && <form className="settings-options" onSubmit={updatePassword}>
            <div className="settings-info-card"><Settings size={17} /><span>Password changes are securely handled by Supabase Authentication.</span></div>
            <label className="settings-field">New password<input required type="password" minLength="8" autoComplete="new-password" value={password} placeholder="At least 8 characters" onChange={(event) => setPassword(event.target.value)} /></label>
            <div className="settings-save-row"><button className="primary-button" disabled={changingPassword}>{changingPassword ? 'Updating…' : 'Update password'}</button></div>
          </form>}
          {section === 'blocked' && <div className="settings-options">{blockedUsers.length ? <div className="blocked-list settings-blocked-list">{blockedUsers.map((userId) => <div key={userId}><span><strong>{userId}</strong><small>Blocked account</small></span><button type="button" className="subtle-button" onClick={() => onUnblock(userId)}>Unblock</button></div>)}</div> : <div className="settings-empty"><span><Users size={20} /></span><strong>No blocked accounts</strong><small>People you block will appear here.</small></div>}</div>}
          {section === 'account' && <div className="settings-options">
            <div className="account-summary"><Avatar profile={profile} /><span><strong>{profile?.full_name}</strong><small>{email}</small></span></div>
            <div className="settings-info-card"><Info size={17} /><span>Your Anveshan ID: <strong>{profile?.user_id}</strong></span></div>
            <button type="button" className="subtle-button account-signout" onClick={onSignOut}><LogOut size={15} />Sign out of Anveshan Chat</button>
            <div className="account-danger-zone"><strong>Delete account</strong><p>Permanently delete your account, profile, and chat history.</p><button type="button" className="subtle-button danger-action" onClick={onDeleteAccount}>Delete my account</button></div>
          </div>}
        </div>
      </div>
    </section>
    </div>
    {avatarCropFile && <AvatarCropModal
      file={avatarCropFile}
      title="Adjust profile photo"
      onCancel={() => setAvatarCropFile(null)}
      onCrop={(croppedFile) => { setAvatarCropFile(null); void uploadAvatar(croppedFile) }}
    />}
  </>
}

function GroupModal({ friends, onClose, onCreate, busy }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState([])
  const [photoFile, setPhotoFile] = useState(null)
  const [photoCropFile, setPhotoCropFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoError, setPhotoError] = useState('')
  const photoInputRef = useRef(null)

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(''); return }
    const previewUrl = URL.createObjectURL(photoFile)
    setPhotoPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [photoFile])

  function choosePhoto(file) {
    setPhotoError('')
    if (!file) { setPhotoFile(null); setPhotoCropFile(null); return }
    if (!validateAvatarImage(file, setPhotoError)) {
      setPhotoFile(null)
      return
    }
    setPhotoCropFile(file)
  }

  return <>
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="group-modal" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !photoCropFile && !photoError) onCreate(name, selected, photoFile) }}>
    <header className="modal-header"><div><span className="eyebrow">BRING YOUR PEOPLE TOGETHER</span><h2>Create a group</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></header>
    <label>Group name<input required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Weekend plans" maxLength="80" /></label>
    <div className="group-photo-picker">
      <span className="group-photo-preview">{photoPreview ? <img src={photoPreview} alt="" /> : <Users size={20} />}</span>
      <span><strong>Group photo</strong><small>{photoFile?.name || 'Optional · JPG, PNG, or WebP · up to 5 MB'}</small></span>
      <input ref={photoInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = '' }} />
      <button type="button" className="subtle-button" onClick={() => photoInputRef.current?.click()}><ImagePlus size={14} />Choose</button>
      {photoError && <small className="group-photo-error" role="alert">{photoError}</small>}
    </div>
    <div className="group-friends-title">ADD FRIENDS <span>{selected.length} selected</span></div>
    <div className="group-friends-list">{friends.length ? friends.map((friend) => <label className="group-friend" key={friend.id}><Avatar profile={friend} /><span><strong>{friend.full_name}</strong><small>@{friend.username}</small></span><input type="checkbox" checked={selected.includes(friend.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, friend.id] : selected.filter((id) => id !== friend.id))} /></label>) : <div className="group-no-friends">Add some friends before creating a group.</div>}</div>
    <div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim() || !selected.length || busy || Boolean(photoError) || Boolean(photoCropFile)}>{busy ? 'Creating…' : 'Create group'}</button></div>
    </form></div>
    {photoCropFile && <AvatarCropModal
      file={photoCropFile}
      title="Adjust group avatar"
      onCancel={() => setPhotoCropFile(null)}
      onCrop={(croppedFile) => { setPhotoCropFile(null); setPhotoFile(croppedFile); setPhotoError('') }}
    />}
  </>
}

export default App
