import React, { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import QRCode from 'qrcode'
import { format, parseISO, differenceInDays, addDays, isPast, startOfDay } from 'date-fns'

// Categories for equipment
const CATEGORIES = ['All', 'Grounds', 'Tools', 'Cleaning', 'Electrical', 'Events', 'Shop', 'Range', 'Other']

// Maintenance intervals in days by category
const MAINTENANCE_INTERVALS = {
  'Grounds': 90,
  'Tools': 180,
  'Cleaning': 90,
  'Electrical': 365,
  'Events': null,
  'Shop': 180,
  'Range': 90,
  'Other': null
}

// Status colors
const STATUS_COLORS = {
  'available': '#10b981',
  'checked-out': '#f59e0b',
  'needs-repair': '#ef4444',
  'out-of-service': '#6b7280'
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const getOverdueCheckouts = (checkouts) => {
  const today = startOfDay(new Date())
  return checkouts.filter(c => {
    if (c.return_date) return false
    if (!c.expected_return) return false
    const expectedDate = startOfDay(parseISO(c.expected_return))
    return isPast(expectedDate)
  }).map(c => ({
    ...c,
    daysOverdue: differenceInDays(today, parseISO(c.expected_return))
  })).sort((a, b) => b.daysOverdue - a.daysOverdue)
}

const getMaintenanceDue = (equipment) => {
  const today = startOfDay(new Date())
  return equipment.filter(eq => {
    const interval = MAINTENANCE_INTERVALS[eq.category]
    if (!interval) return false
    if (!eq.last_maintenance) return true
    const lastMaint = parseISO(eq.last_maintenance)
    const nextDue = addDays(lastMaint, interval)
    return isPast(nextDue) || differenceInDays(nextDue, today) <= 14
  }).map(eq => {
    const interval = MAINTENANCE_INTERVALS[eq.category]
    let daysPast = null
    let nextDue = null
    if (eq.last_maintenance) {
      const lastMaint = parseISO(eq.last_maintenance)
      nextDue = addDays(lastMaint, interval)
      daysPast = differenceInDays(today, nextDue)
    }
    return { ...eq, daysPastDue: daysPast, nextDueDate: nextDue, neverMaintained: !eq.last_maintenance }
  }).sort((a, b) => {
    if (a.neverMaintained && !b.neverMaintained) return -1
    if (!a.neverMaintained && b.neverMaintained) return 1
    return (b.daysPastDue || 0) - (a.daysPastDue || 0)
  })
}

const exportToCSV = (data, filename, columns) => {
  const headers = columns.map(c => c.header).join(',')
  const rows = data.map(row => 
    columns.map(c => {
      let value = c.accessor(row)
      if (value === null || value === undefined) value = ''
      value = String(value)
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = `"${value.replace(/"/g, '""')}"`
      }
      return value
    }).join(',')
  )
  const csv = [headers, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`
  link.click()
}

// ============================================
// MAIN APP
// ============================================

export default function App() {
  // Auth state
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [loginMode, setLoginMode] = useState('member') // 'member' or 'chair'

  // Data state
  const [equipment, setEquipment] = useState([])
  const [checkouts, setCheckouts] = useState([])
  const [deficiencies, setDeficiencies] = useState([])

  // UI state
  const [activeTab, setActiveTab] = useState('checkout')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedEquipment, setSelectedEquipment] = useState(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrEquipment, setQrEquipment] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [notification, setNotification] = useState(null)

  // Form state
  const [checkoutForm, setCheckoutForm] = useState({ useType: 'club', purpose: '', expectedReturn: '' })
  const [returnForm, setReturnForm] = useState({ condition: 'good', deficiencyDesc: '', severity: 'minor' })
  const [newEquipment, setNewEquipment] = useState({ name: '', category: 'Tools', location: '', notes: '' })

  const scanInputRef = useRef(null)

  const overdueCheckouts = getOverdueCheckouts(checkouts)
  const maintenanceDue = getMaintenanceDue(equipment)

  // Fetch all equipment data
  const fetchAllData = async () => {
    await Promise.all([fetchEquipment(), fetchCheckouts(), fetchDeficiencies()])
  }

  const fetchEquipment = async () => {
    const { data } = await supabase.from('eq_equipment').select('*').order('equipment_code')
    setEquipment(data || [])
  }

  const fetchCheckouts = async () => {
    const { data } = await supabase.from('eq_checkouts').select(`*, eq_equipment (equipment_code, name, category), users (first_name, last_name, employee_number)`).order('checkout_date', { ascending: false })
    setCheckouts(data || [])
  }

  const fetchDeficiencies = async () => {
    const { data } = await supabase.from('eq_deficiencies').select(`*, eq_equipment (equipment_code, name), users!eq_deficiencies_reported_by_fkey (first_name, last_name)`).order('reported_date', { ascending: false })
    setDeficiencies(data || [])
  }

  useEffect(() => {
    if (user && activeTab === 'checkout' && scanInputRef.current) scanInputRef.current.focus()
  }, [user, activeTab])

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 4000)
  }

  // Member login - just enter member number
  const handleMemberLogin = async (memberNumber) => {
    setAuthError('')
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('employee_number', parseInt(memberNumber))
        .single()
      
      if (error || !data) {
        throw new Error('Member number not found')
      }
      
      setUser(data)
      fetchAllData()
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Chair/Admin login - email/password via Supabase Auth
  const handleChairLogin = async (email, password) => {
    setAuthError('')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      
      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single()
      
      if (profileError) throw new Error('User profile not found')
      
      if (profile.role !== 'admin' && profile.role !== 'chair') {
        throw new Error('This login is for chairs/admins only. Use member login.')
      }
      
      setUser(profile)
      fetchAllData()
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle logout
  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const handleScanSearch = (value) => {
    setSearchTerm(value)
    const exactMatch = equipment.find(eq => eq.equipment_code.toLowerCase() === value.toLowerCase())
    if (exactMatch) { setSelectedEquipment(exactMatch); setSearchTerm('') }
  }

  const filteredEquipment = equipment.filter(eq => {
    const matchesSearch = eq.name.toLowerCase().includes(searchTerm.toLowerCase()) || eq.equipment_code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === 'All' || eq.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const handleCheckout = async () => {
    if (!selectedEquipment || selectedEquipment.status !== 'available') return
    try {
      const { error } = await supabase.from('eq_checkouts').insert({ equipment_id: selectedEquipment.id, user_id: user.id, expected_return: checkoutForm.expectedReturn || null, use_type: checkoutForm.useType, purpose: checkoutForm.purpose })
      if (error) throw error
      showNotification(`${selectedEquipment.name} checked out successfully`)
      setSelectedEquipment(null)
      setCheckoutForm({ useType: 'club', purpose: '', expectedReturn: '' })
      fetchAllData()
    } catch (error) {
      console.error('Checkout error:', error)
      showNotification('Error checking out equipment', 'error')
    }
  }

  const handleReturn = async () => {
    if (!selectedEquipment) return
    const activeCheckout = checkouts.find(c => c.equipment_id === selectedEquipment.id && !c.return_date)
    if (!activeCheckout) return
    try {
      await supabase.from('eq_checkouts').update({ return_date: new Date().toISOString(), return_condition: returnForm.condition === 'good' ? 'good' : 'deficiency' }).eq('id', activeCheckout.id)
      if (returnForm.condition === 'deficiency' && returnForm.deficiencyDesc) {
        await supabase.from('eq_deficiencies').insert({ equipment_id: selectedEquipment.id, checkout_id: activeCheckout.id, reported_by: user.id, description: returnForm.deficiencyDesc, severity: returnForm.severity })
        showNotification(`${selectedEquipment.name} returned with deficiency reported`, 'warning')
      } else {
        showNotification(`${selectedEquipment.name} returned successfully`)
      }
      setSelectedEquipment(null)
      setReturnForm({ condition: 'good', deficiencyDesc: '', severity: 'minor' })
      fetchAllData()
    } catch (error) {
      showNotification('Error returning equipment', 'error')
    }
  }

  const handleAddEquipment = async () => {
    if (!newEquipment.name) return
    try {
      const { data: codeData } = await supabase.rpc('generate_equipment_code')
      const equipmentCode = codeData || `EQ${String(equipment.length + 1).padStart(3, '0')}`
      await supabase.from('eq_equipment').insert({ equipment_code: equipmentCode, name: newEquipment.name, category: newEquipment.category, location: newEquipment.location, notes: newEquipment.notes, status: 'available' })
      showNotification(`${newEquipment.name} added to inventory`)
      setNewEquipment({ name: '', category: 'Tools', location: '', notes: '' })
      fetchEquipment()
    } catch (error) {
      showNotification('Error adding equipment', 'error')
    }
  }

  const handleUpdateMaintenance = async (equipmentId) => {
    try {
      await supabase.from('eq_equipment').update({ last_maintenance: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() }).eq('id', equipmentId)
      showNotification('Maintenance date updated')
      fetchEquipment()
    } catch (error) {
      showNotification('Error updating maintenance', 'error')
    }
  }

  const showQR = async (eq) => {
    setQrEquipment(eq)
    try {
      const url = await QRCode.toDataURL(eq.equipment_code, { width: 200, margin: 2, color: { dark: '#1e3a5f', light: '#ffffff' } })
      setQrDataUrl(url)
      setShowQRModal(true)
    } catch (error) { console.error('QR error:', error) }
  }

  const resolveDeficiency = async (defId) => {
    try {
      await supabase.from('eq_deficiencies').update({ status: 'resolved', resolved_by: user.id, resolved_date: new Date().toISOString().split('T')[0], resolution_notes: 'Resolved' }).eq('id', defId)
      showNotification('Deficiency marked as resolved')
      fetchAllData()
    } catch (error) {
      showNotification('Error resolving deficiency', 'error')
    }
  }

  const exportEquipmentList = () => {
    exportToCSV(equipment, 'equipment_inventory', [
      { header: 'Code', accessor: r => r.equipment_code },
      { header: 'Name', accessor: r => r.name },
      { header: 'Category', accessor: r => r.category },
      { header: 'Location', accessor: r => r.location },
      { header: 'Status', accessor: r => r.status },
      { header: 'Last Maintenance', accessor: r => r.last_maintenance || 'Never' },
      { header: 'Notes', accessor: r => r.notes }
    ])
    showNotification('Equipment list exported')
  }

  const exportCheckoutHistory = () => {
    exportToCSV(checkouts, 'checkout_history', [
      { header: 'Equipment', accessor: r => r.eq_equipment?.name },
      { header: 'Code', accessor: r => r.eq_equipment?.equipment_code },
      { header: 'Member', accessor: r => `${r.users?.first_name} ${r.users?.last_name}` },
      { header: 'Use Type', accessor: r => r.use_type },
      { header: 'Purpose', accessor: r => r.purpose },
      { header: 'Checkout Date', accessor: r => r.checkout_date ? format(parseISO(r.checkout_date), 'yyyy-MM-dd') : '' },
      { header: 'Expected Return', accessor: r => r.expected_return || '' },
      { header: 'Return Date', accessor: r => r.return_date ? format(parseISO(r.return_date), 'yyyy-MM-dd') : 'Still Out' },
      { header: 'Return Condition', accessor: r => r.return_condition || '' }
    ])
    showNotification('Checkout history exported')
  }

  const exportDeficiencies = () => {
    exportToCSV(deficiencies, 'deficiencies_report', [
      { header: 'Equipment', accessor: r => r.eq_equipment?.name },
      { header: 'Description', accessor: r => r.description },
      { header: 'Severity', accessor: r => r.severity },
      { header: 'Status', accessor: r => r.status },
      { header: 'Reported By', accessor: r => `${r.users?.first_name} ${r.users?.last_name}` },
      { header: 'Reported Date', accessor: r => r.reported_date },
      { header: 'Resolved Date', accessor: r => r.resolved_date || '' }
    ])
    showNotification('Deficiencies report exported')
  }

  const exportMaintenanceSchedule = () => {
    const allWithMaintenance = equipment.filter(eq => MAINTENANCE_INTERVALS[eq.category])
    exportToCSV(allWithMaintenance, 'maintenance_schedule', [
      { header: 'Code', accessor: r => r.equipment_code },
      { header: 'Name', accessor: r => r.name },
      { header: 'Category', accessor: r => r.category },
      { header: 'Last Maintenance', accessor: r => r.last_maintenance || 'Never' },
      { header: 'Interval (Days)', accessor: r => MAINTENANCE_INTERVALS[r.category] },
      { header: 'Next Due', accessor: r => !r.last_maintenance ? 'Overdue - Never Done' : format(addDays(parseISO(r.last_maintenance), MAINTENANCE_INTERVALS[r.category]), 'yyyy-MM-dd') },
      { header: 'Status', accessor: r => {
        if (!r.last_maintenance) return 'OVERDUE'
        const next = addDays(parseISO(r.last_maintenance), MAINTENANCE_INTERVALS[r.category])
        if (isPast(next)) return 'OVERDUE'
        if (differenceInDays(next, new Date()) <= 14) return 'DUE SOON'
        return 'OK'
      }}
    ])
    showNotification('Maintenance schedule exported')
  }

  // ============================================
  // LOGIN SCREEN
  // ============================================
  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginCard}>
          <div style={styles.loginHeader}>
            <div style={styles.logoIcon}>🔧</div>
            <h1 style={styles.loginTitle}>Equipment Checkout</h1>
            <p style={styles.loginSubtitle}>Groton Sportsmen's Club</p>
          </div>

          {/* Login Mode Tabs */}
          <div style={styles.loginTabs}>
            <button 
              onClick={() => { setLoginMode('member'); setAuthError('') }}
              style={loginMode === 'member' ? styles.loginTabActive : styles.loginTab}
            >
              👤 Member
            </button>
            <button 
              onClick={() => { setLoginMode('chair'); setAuthError('') }}
              style={loginMode === 'chair' ? styles.loginTabActive : styles.loginTab}
            >
              👔 Chair/Admin
            </button>
          </div>

          {loginMode === 'member' ? (
            <MemberLogin onLogin={handleMemberLogin} error={authError} loading={loading} />
          ) : (
            <ChairLogin onLogin={handleChairLogin} error={authError} loading={loading} />
          )}
        </div>
      </div>
    )
  }

  const isAdmin = user.role === 'admin' || user.role === 'chair'
  const alertCount = overdueCheckouts.length + maintenanceDue.length + deficiencies.filter(d => d.status === 'pending').length

  // ============================================
  // MAIN APP
  // ============================================
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerIcon}>🔧</span>
          <div>
            <h1 style={styles.headerTitle}>Equipment Checkout</h1>
            <p style={styles.headerSubtitle}>Groton Sportsmen's Club</p>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userBadge}>{isAdmin ? '👔' : '👤'} {user.first_name} {user.last_name}</span>
          <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
        </div>
      </header>

      <nav style={styles.nav}>
        <button onClick={() => setActiveTab('checkout')} style={activeTab === 'checkout' ? styles.navBtnActive : styles.navBtn}>📤 Checkout/Return</button>
        <button onClick={() => setActiveTab('inventory')} style={activeTab === 'inventory' ? styles.navBtnActive : styles.navBtn}>📋 Inventory</button>
        <button onClick={() => setActiveTab('deficiencies')} style={activeTab === 'deficiencies' ? styles.navBtnActive : styles.navBtn}>
          ⚠️ Deficiencies {deficiencies.filter(d => d.status === 'pending').length > 0 && <span style={styles.badge}>{deficiencies.filter(d => d.status === 'pending').length}</span>}
        </button>
        <button onClick={() => setActiveTab('history')} style={activeTab === 'history' ? styles.navBtnActive : styles.navBtn}>📜 History</button>
        {isAdmin && (
          <>
            <button onClick={() => setActiveTab('alerts')} style={activeTab === 'alerts' ? styles.navBtnActive : styles.navBtn}>
              🔔 Alerts {alertCount > 0 && <span style={styles.badgeRed}>{alertCount}</span>}
            </button>
            <button onClick={() => setActiveTab('admin')} style={activeTab === 'admin' ? styles.navBtnActive : styles.navBtn}>⚙️ Admin</button>
          </>
        )}
      </nav>

      {notification && (
        <div style={{...styles.notification, backgroundColor: notification.type === 'success' ? '#10b981' : notification.type === 'warning' ? '#f59e0b' : '#ef4444'}}>
          {notification.message}
        </div>
      )}

      <main style={styles.main}>
        {activeTab === 'checkout' && <CheckoutTab scanInputRef={scanInputRef} searchTerm={searchTerm} handleScanSearch={handleScanSearch} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} filteredEquipment={filteredEquipment} selectedEquipment={selectedEquipment} setSelectedEquipment={setSelectedEquipment} checkoutForm={checkoutForm} setCheckoutForm={setCheckoutForm} handleCheckout={handleCheckout} returnForm={returnForm} setReturnForm={setReturnForm} handleReturn={handleReturn} checkouts={checkouts} />}
        {activeTab === 'inventory' && <InventoryTab equipment={equipment} searchTerm={searchTerm} setSearchTerm={setSearchTerm} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} filteredEquipment={filteredEquipment} showQR={showQR} isAdmin={isAdmin} exportEquipmentList={exportEquipmentList} />}
        {activeTab === 'deficiencies' && <DeficienciesTab deficiencies={deficiencies} isAdmin={isAdmin} resolveDeficiency={resolveDeficiency} exportDeficiencies={exportDeficiencies} />}
        {activeTab === 'history' && <HistoryTab checkouts={checkouts} exportCheckoutHistory={exportCheckoutHistory} isAdmin={isAdmin} />}
        {activeTab === 'alerts' && isAdmin && <AlertsTab overdueCheckouts={overdueCheckouts} maintenanceDue={maintenanceDue} deficiencies={deficiencies} handleUpdateMaintenance={handleUpdateMaintenance} />}
        {activeTab === 'admin' && isAdmin && <AdminTab equipment={equipment} checkouts={checkouts} deficiencies={deficiencies} newEquipment={newEquipment} setNewEquipment={setNewEquipment} handleAddEquipment={handleAddEquipment} exportEquipmentList={exportEquipmentList} exportCheckoutHistory={exportCheckoutHistory} exportDeficiencies={exportDeficiencies} exportMaintenanceSchedule={exportMaintenanceSchedule} />}
      </main>

      {showQRModal && qrEquipment && (
        <div style={styles.modalOverlay} onClick={() => setShowQRModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{qrEquipment.name}</h3>
            <p style={styles.modalId}>ID: {qrEquipment.equipment_code}</p>
            <div style={styles.qrContainer}>{qrDataUrl && <img src={qrDataUrl} alt="QR Code" />}</div>
            <p style={styles.qrInstructions}>Print this QR code and attach to the equipment.</p>
            <div style={styles.modalButtons}>
              <button onClick={() => window.print()} style={styles.printModalBtn}>🖨️ Print</button>
              <button onClick={() => setShowQRModal(false)} style={styles.closeModalBtn}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// LOGIN COMPONENTS
// ============================================

function MemberLogin({ onLogin, error, loading }) {
  const [memberNumber, setMemberNumber] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (memberNumber) onLogin(memberNumber)
  }

  return (
    <form onSubmit={handleSubmit} style={styles.loginForm}>
      <p style={styles.loginHelp}>Enter your member number to check out or return equipment.</p>
      
      <div style={styles.formGroup}>
        <label style={styles.loginLabel}>Member Number</label>
        <input
          type="number"
          value={memberNumber}
          onChange={(e) => setMemberNumber(e.target.value)}
          placeholder="Enter your member #"
          style={styles.loginInputLarge}
          autoFocus
        />
      </div>

      {error && <p style={styles.errorText}>{error}</p>}
      
      <button type="submit" style={styles.loginBtn} disabled={!memberNumber || loading}>
        {loading ? 'Checking...' : 'Continue →'}
      </button>
    </form>
  )
}

function ChairLogin({ onLogin, error, loading }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    await onLogin(email, password)
  }

  return (
    <form onSubmit={handleSubmit} style={styles.loginForm}>
      <p style={styles.loginHelp}>Chair/Admin login for full management access.</p>
      
      <div style={styles.formGroup}>
        <label style={styles.loginLabel}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={styles.loginInput} placeholder="Enter email" required />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.loginLabel}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={styles.loginInput} placeholder="Enter password" required />
      </div>
      {error && <p style={styles.errorText}>{error}</p>}
      <button type="submit" style={styles.loginBtn} disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
    </form>
  )
}

// ============================================
// TAB COMPONENTS
// ============================================

function CheckoutTab({ scanInputRef, searchTerm, handleScanSearch, selectedCategory, setSelectedCategory, filteredEquipment, selectedEquipment, setSelectedEquipment, checkoutForm, setCheckoutForm, handleCheckout, returnForm, setReturnForm, handleReturn, checkouts }) {
  return (
    <div style={styles.checkoutContainer}>
      <div style={styles.scanSection}>
        <label style={styles.scanLabel}>Scan QR Code or Search Equipment</label>
        <input ref={scanInputRef} type="text" value={searchTerm} onChange={(e) => handleScanSearch(e.target.value)} placeholder="Scan barcode or type to search..." style={styles.scanInput} autoFocus />
      </div>
      <div style={styles.checkoutGrid}>
        <div style={styles.equipmentList}>
          <h3 style={styles.sectionTitle}>Available Equipment</h3>
          <div style={styles.categoryFilter}>{CATEGORIES.map(cat => (<button key={cat} onClick={() => setSelectedCategory(cat)} style={selectedCategory === cat ? styles.catBtnActive : styles.catBtn}>{cat}</button>))}</div>
          <div style={styles.equipmentListScroll}>
            {filteredEquipment.map(eq => (
              <div key={eq.id} onClick={() => setSelectedEquipment(eq)} style={{...styles.equipmentItem, borderLeft: `4px solid ${STATUS_COLORS[eq.status]}`, backgroundColor: selectedEquipment?.id === eq.id ? '#e0f2fe' : '#fff'}}>
                <div style={styles.eqItemMain}><span style={styles.eqId}>{eq.equipment_code}</span><span style={styles.eqName}>{eq.name}</span></div>
                <div style={styles.eqItemSub}><span style={styles.eqCategory}>{eq.category}</span><span style={{...styles.eqStatus, color: STATUS_COLORS[eq.status]}}>{eq.status.replace('-', ' ')}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div style={styles.actionPanel}>
          {selectedEquipment ? (
            <>
              <div style={styles.selectedEquipment}>
                <h3 style={styles.selectedTitle}>{selectedEquipment.name}</h3>
                <p style={styles.selectedId}>ID: {selectedEquipment.equipment_code}</p>
                <p style={styles.selectedDetail}>📍 {selectedEquipment.location || 'Not specified'}</p>
                <p style={styles.selectedDetail}>📁 {selectedEquipment.category}</p>
                {selectedEquipment.notes && <p style={styles.selectedNotes}>📝 {selectedEquipment.notes}</p>}
                <div style={{...styles.statusBadge, backgroundColor: STATUS_COLORS[selectedEquipment.status]}}>{selectedEquipment.status.replace('-', ' ').toUpperCase()}</div>
              </div>
              {selectedEquipment.status === 'available' && (
                <div style={styles.formSection}>
                  <h4 style={styles.formTitle}>Check Out Equipment</h4>
                  <div style={styles.formGroup}><label style={styles.label}>Use Type</label><select value={checkoutForm.useType} onChange={(e) => setCheckoutForm({...checkoutForm, useType: e.target.value})} style={styles.select}><option value="club">Club Work</option><option value="personal">Personal Use</option></select></div>
                  <div style={styles.formGroup}><label style={styles.label}>Purpose</label><input type="text" value={checkoutForm.purpose} onChange={(e) => setCheckoutForm({...checkoutForm, purpose: e.target.value})} placeholder="What will you be using this for?" style={styles.input} /></div>
                  <div style={styles.formGroup}><label style={styles.label}>Expected Return Date</label><input type="date" value={checkoutForm.expectedReturn} onChange={(e) => setCheckoutForm({...checkoutForm, expectedReturn: e.target.value})} style={styles.input} min={new Date().toISOString().split('T')[0]} /></div>
                  <button onClick={handleCheckout} style={styles.checkoutBtn}>✅ Check Out</button>
                </div>
              )}
              {selectedEquipment.status === 'checked-out' && (
                <div style={styles.formSection}>
                  <h4 style={styles.formTitle}>Return Equipment</h4>
                  {(() => { const checkout = checkouts.find(c => c.equipment_id === selectedEquipment.id && !c.return_date); return checkout && (<div style={styles.checkoutInfo}><p>Checked out by: <strong>{checkout.users?.first_name} {checkout.users?.last_name}</strong></p><p>Date: {format(parseISO(checkout.checkout_date), 'MMM d, yyyy')}</p><p>Purpose: {checkout.purpose || 'Not specified'}</p><p>Type: {checkout.use_type === 'club' ? 'Club Work' : 'Personal Use'}</p></div>) })()}
                  <div style={styles.formGroup}><label style={styles.label}>Condition</label><select value={returnForm.condition} onChange={(e) => setReturnForm({...returnForm, condition: e.target.value})} style={styles.select}><option value="good">Good - No Issues</option><option value="deficiency">Report Deficiency</option></select></div>
                  {returnForm.condition === 'deficiency' && (<><div style={styles.formGroup}><label style={styles.label}>Severity</label><select value={returnForm.severity} onChange={(e) => setReturnForm({...returnForm, severity: e.target.value})} style={styles.select}><option value="minor">Minor - Still Usable</option><option value="major">Major - Needs Repair</option></select></div><div style={styles.formGroup}><label style={styles.label}>Describe the Issue</label><textarea value={returnForm.deficiencyDesc} onChange={(e) => setReturnForm({...returnForm, deficiencyDesc: e.target.value})} placeholder="Describe the problem..." style={styles.textarea} rows={3} /></div></>)}
                  <button onClick={handleReturn} style={styles.returnBtn}>📥 Return Equipment</button>
                </div>
              )}
              {selectedEquipment.status === 'needs-repair' && (<div style={styles.repairMessage}><span style={styles.repairIcon}>🔧</span><p>This equipment needs repair and cannot be checked out.</p><p style={styles.repairNote}>See Deficiencies tab for details.</p></div>)}
            </>
          ) : (<div style={styles.noSelection}><span style={styles.noSelectionIcon}>👆</span><p>Select equipment from the list or scan a QR code</p></div>)}
        </div>
      </div>
    </div>
  )
}

function InventoryTab({ equipment, searchTerm, setSearchTerm, selectedCategory, setSelectedCategory, filteredEquipment, showQR, isAdmin, exportEquipmentList }) {
  return (
    <div style={styles.inventoryContainer}>
      <div style={styles.inventoryHeader}>
        <h2 style={styles.pageTitle}>Equipment Inventory</h2>
        <div style={styles.inventoryStats}>
          <span style={styles.statBadge}><span style={{...styles.statDot, backgroundColor: '#10b981'}}></span>{equipment.filter(e => e.status === 'available').length} Available</span>
          <span style={styles.statBadge}><span style={{...styles.statDot, backgroundColor: '#f59e0b'}}></span>{equipment.filter(e => e.status === 'checked-out').length} Checked Out</span>
          <span style={styles.statBadge}><span style={{...styles.statDot, backgroundColor: '#ef4444'}}></span>{equipment.filter(e => e.status === 'needs-repair').length} Needs Repair</span>
          {isAdmin && <button onClick={exportEquipmentList} style={styles.exportBtn}>📥 Export CSV</button>}
        </div>
      </div>
      <div style={styles.inventoryFilters}><input type="text" placeholder="Search equipment..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={styles.searchInput} /><select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={styles.filterSelect}>{CATEGORIES.map(cat => (<option key={cat} value={cat}>{cat}</option>))}</select></div>
      <div style={styles.inventoryTable}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>ID</th><th style={styles.th}>Name</th><th style={styles.th}>Category</th><th style={styles.th}>Location</th><th style={styles.th}>Status</th><th style={styles.th}>Last Maintenance</th><th style={styles.th}>Actions</th></tr></thead>
          <tbody>{filteredEquipment.map(eq => (<tr key={eq.id} style={styles.tr}><td style={styles.td}>{eq.equipment_code}</td><td style={styles.td}>{eq.name}</td><td style={styles.td}>{eq.category}</td><td style={styles.td}>{eq.location || '—'}</td><td style={styles.td}><span style={{...styles.tableStatus, backgroundColor: STATUS_COLORS[eq.status] + '20', color: STATUS_COLORS[eq.status]}}>{eq.status.replace('-', ' ')}</span></td><td style={styles.td}>{eq.last_maintenance ? format(parseISO(eq.last_maintenance), 'MMM d, yyyy') : 'Never'}</td><td style={styles.td}><button onClick={() => showQR(eq)} style={styles.qrBtn}>QR Code</button></td></tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}

function DeficienciesTab({ deficiencies, isAdmin, resolveDeficiency, exportDeficiencies }) {
  const pending = deficiencies.filter(d => d.status === 'pending')
  const resolved = deficiencies.filter(d => d.status === 'resolved')
  return (
    <div style={styles.deficienciesContainer}>
      <div style={styles.deficienciesHeader}><h2 style={styles.pageTitle}>Equipment Deficiencies</h2>{isAdmin && <button onClick={exportDeficiencies} style={styles.exportBtn}>📥 Export CSV</button>}</div>
      <div style={styles.deficiencyList}>
        {pending.length === 0 ? (<div style={styles.noDeficiencies}><span style={styles.noDefIcon}>✅</span><p>No pending deficiencies</p></div>) : pending.map(def => (
          <div key={def.id} style={styles.deficiencyCard}>
            <div style={styles.defHeader}><span style={{...styles.severityBadge, backgroundColor: def.severity === 'major' ? '#fee2e2' : '#fef3c7', color: def.severity === 'major' ? '#dc2626' : '#d97706'}}>{def.severity.toUpperCase()}</span><span style={styles.defDate}>{def.reported_date}</span></div>
            <h4 style={styles.defEquipment}>{def.eq_equipment?.name || 'Unknown'}</h4>
            <p style={styles.defDescription}>{def.description}</p>
            <p style={styles.defReporter}>Reported by: {def.users?.first_name} {def.users?.last_name}</p>
            {isAdmin && <button onClick={() => resolveDeficiency(def.id)} style={styles.resolveBtn}>Mark Resolved</button>}
          </div>
        ))}
      </div>
      {resolved.length > 0 && (<><h3 style={styles.resolvedTitle}>Resolved Deficiencies</h3><div style={styles.resolvedList}>{resolved.slice(0, 10).map(def => (<div key={def.id} style={styles.resolvedCard}><span style={styles.resolvedEquip}>{def.eq_equipment?.name}</span><span style={styles.resolvedDesc}>{def.description}</span><span style={styles.resolvedDate}>{def.reported_date}</span></div>))}</div></>)}
    </div>
  )
}

function HistoryTab({ checkouts, exportCheckoutHistory, isAdmin }) {
  return (
    <div style={styles.historyContainer}>
      <div style={styles.historyHeader}><h2 style={styles.pageTitle}>Checkout History</h2>{isAdmin && <button onClick={exportCheckoutHistory} style={styles.exportBtn}>📥 Export CSV</button>}</div>
      <div style={styles.historyTable}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Equipment</th><th style={styles.th}>Member</th><th style={styles.th}>Use Type</th><th style={styles.th}>Purpose</th><th style={styles.th}>Checkout</th><th style={styles.th}>Expected</th><th style={styles.th}>Returned</th><th style={styles.th}>Status</th></tr></thead>
          <tbody>{checkouts.map(c => { const isOverdue = !c.return_date && c.expected_return && isPast(parseISO(c.expected_return)); return (
            <tr key={c.id} style={{...styles.tr, backgroundColor: isOverdue ? '#fef2f2' : 'transparent'}}><td style={styles.td}>{c.eq_equipment?.name}</td><td style={styles.td}>{c.users?.first_name} {c.users?.last_name}</td><td style={styles.td}><span style={{...styles.useTypeBadge, backgroundColor: c.use_type === 'club' ? '#dbeafe' : '#fce7f3', color: c.use_type === 'club' ? '#1d4ed8' : '#be185d'}}>{c.use_type === 'club' ? 'Club' : 'Personal'}</span></td><td style={styles.td}>{c.purpose || '—'}</td><td style={styles.td}>{c.checkout_date ? format(parseISO(c.checkout_date), 'MMM d, yyyy') : '—'}</td><td style={styles.td}>{c.expected_return || '—'}</td><td style={styles.td}>{c.return_date ? format(parseISO(c.return_date), 'MMM d, yyyy') : '—'}</td><td style={styles.td}>{c.return_date ? <span style={styles.returnedBadge}>Returned</span> : isOverdue ? <span style={styles.overdueBadge}>Overdue</span> : <span style={styles.outBadge}>Out</span>}</td></tr>
          )})}</tbody>
        </table>
      </div>
    </div>
  )
}

function AlertsTab({ overdueCheckouts, maintenanceDue, deficiencies, handleUpdateMaintenance }) {
  const pending = deficiencies.filter(d => d.status === 'pending')
  return (
    <div style={styles.alertsContainer}>
      <h2 style={styles.pageTitle}>🔔 Alerts & Notifications</h2>
      <div style={styles.alertSection}>
        <h3 style={styles.alertSectionTitle}><span style={styles.alertIcon}>⏰</span>Overdue Checkouts ({overdueCheckouts.length})</h3>
        {overdueCheckouts.length === 0 ? <p style={styles.noAlerts}>No overdue checkouts</p> : (
          <div style={styles.alertList}>{overdueCheckouts.map(c => (<div key={c.id} style={styles.alertCard}><div style={styles.alertCardHeader}><span style={styles.alertEquipment}>{c.eq_equipment?.name}</span><span style={styles.overdueDays}>{c.daysOverdue} days overdue</span></div><p style={styles.alertDetail}>Checked out by: <strong>{c.users?.first_name} {c.users?.last_name}</strong></p><p style={styles.alertDetail}>Expected return: {c.expected_return}</p><p style={styles.alertDetail}>Purpose: {c.purpose || 'Not specified'}</p></div>))}</div>
        )}
      </div>
      <div style={styles.alertSection}>
        <h3 style={styles.alertSectionTitle}><span style={styles.alertIcon}>🔧</span>Maintenance Due ({maintenanceDue.length})</h3>
        {maintenanceDue.length === 0 ? <p style={styles.noAlerts}>No maintenance due</p> : (
          <div style={styles.alertList}>{maintenanceDue.map(eq => (<div key={eq.id} style={styles.alertCard}><div style={styles.alertCardHeader}><span style={styles.alertEquipment}>{eq.name}</span><span style={{...styles.maintenanceStatus, backgroundColor: eq.neverMaintained ? '#fee2e2' : eq.daysPastDue > 0 ? '#fef3c7' : '#dcfce7', color: eq.neverMaintained ? '#dc2626' : eq.daysPastDue > 0 ? '#d97706' : '#16a34a'}}>{eq.neverMaintained ? 'Never Done' : eq.daysPastDue > 0 ? `${eq.daysPastDue} days overdue` : 'Due Soon'}</span></div><p style={styles.alertDetail}>Category: {eq.category}</p><p style={styles.alertDetail}>Last maintenance: {eq.last_maintenance ? format(parseISO(eq.last_maintenance), 'MMM d, yyyy') : 'Never'}</p><p style={styles.alertDetail}>Interval: Every {MAINTENANCE_INTERVALS[eq.category]} days</p><button onClick={() => handleUpdateMaintenance(eq.id)} style={styles.markMaintainedBtn}>✓ Mark Maintained Today</button></div>))}</div>
        )}
      </div>
      <div style={styles.alertSection}>
        <h3 style={styles.alertSectionTitle}><span style={styles.alertIcon}>⚠️</span>Pending Deficiencies ({pending.length})</h3>
        {pending.length === 0 ? <p style={styles.noAlerts}>No pending deficiencies</p> : (
          <div style={styles.alertList}>{pending.slice(0, 5).map(def => (<div key={def.id} style={styles.alertCard}><div style={styles.alertCardHeader}><span style={styles.alertEquipment}>{def.eq_equipment?.name}</span><span style={{...styles.severityBadge, backgroundColor: def.severity === 'major' ? '#fee2e2' : '#fef3c7', color: def.severity === 'major' ? '#dc2626' : '#d97706'}}>{def.severity.toUpperCase()}</span></div><p style={styles.alertDetail}>{def.description}</p><p style={styles.alertDetail}>Reported: {def.reported_date}</p></div>))}{pending.length > 5 && <p style={styles.moreAlerts}>+ {pending.length - 5} more deficiencies</p>}</div>
        )}
      </div>
    </div>
  )
}

function AdminTab({ equipment, checkouts, deficiencies, newEquipment, setNewEquipment, handleAddEquipment, exportEquipmentList, exportCheckoutHistory, exportDeficiencies, exportMaintenanceSchedule }) {
  return (
    <div style={styles.adminContainer}>
      <h2 style={styles.pageTitle}>Administration</h2>
      <div style={styles.adminGrid}>
        <div style={styles.adminCard}>
          <h3 style={styles.adminCardTitle}>➕ Add New Equipment</h3>
          <div style={styles.formGroup}><label style={styles.label}>Equipment Name</label><input type="text" value={newEquipment.name} onChange={(e) => setNewEquipment({...newEquipment, name: e.target.value})} placeholder="e.g., Craftsman Table Saw" style={styles.input} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Category</label><select value={newEquipment.category} onChange={(e) => setNewEquipment({...newEquipment, category: e.target.value})} style={styles.select}>{CATEGORIES.filter(c => c !== 'All').map(cat => (<option key={cat} value={cat}>{cat}</option>))}</select></div>
          <div style={styles.formGroup}><label style={styles.label}>Storage Location</label><input type="text" value={newEquipment.location} onChange={(e) => setNewEquipment({...newEquipment, location: e.target.value})} placeholder="e.g., Shed A, Workshop" style={styles.input} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Notes (optional)</label><textarea value={newEquipment.notes} onChange={(e) => setNewEquipment({...newEquipment, notes: e.target.value})} placeholder="Any special instructions..." style={styles.textarea} rows={2} /></div>
          <button onClick={handleAddEquipment} style={styles.addBtn}>Add Equipment</button>
        </div>
        <div style={styles.adminCard}>
          <h3 style={styles.adminCardTitle}>📊 Statistics</h3>
          <div style={styles.statsList}>
            <div style={styles.statRow}><span>Total Equipment</span><strong>{equipment.length}</strong></div>
            <div style={styles.statRow}><span>Currently Checked Out</span><strong>{equipment.filter(e => e.status === 'checked-out').length}</strong></div>
            <div style={styles.statRow}><span>Needs Repair</span><strong>{equipment.filter(e => e.status === 'needs-repair').length}</strong></div>
            <div style={styles.statRow}><span>Total Checkouts</span><strong>{checkouts.length}</strong></div>
            <div style={styles.statRow}><span>Pending Deficiencies</span><strong>{deficiencies.filter(d => d.status === 'pending').length}</strong></div>
          </div>
        </div>
        <div style={styles.adminCard}>
          <h3 style={styles.adminCardTitle}>📥 Export Reports</h3>
          <p style={styles.adminDesc}>Download data as CSV files for Excel or spreadsheet applications.</p>
          <div style={styles.exportButtonGroup}>
            <button onClick={exportEquipmentList} style={styles.exportBtnLarge}>📋 Equipment Inventory</button>
            <button onClick={exportCheckoutHistory} style={styles.exportBtnLarge}>📜 Checkout History</button>
            <button onClick={exportDeficiencies} style={styles.exportBtnLarge}>⚠️ Deficiencies Report</button>
            <button onClick={exportMaintenanceSchedule} style={styles.exportBtnLarge}>🔧 Maintenance Schedule</button>
          </div>
        </div>
        <div style={styles.adminCard}>
          <h3 style={styles.adminCardTitle}>🗓️ Maintenance Schedule</h3>
          <p style={styles.adminDesc}>Default maintenance intervals by category:</p>
          <div style={styles.statsList}>{Object.entries(MAINTENANCE_INTERVALS).filter(([_, v]) => v).map(([cat, days]) => (<div key={cat} style={styles.statRow}><span>{cat}</span><strong>Every {days} days</strong></div>))}</div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// STYLES
// ============================================

const styles = {
  loadingContainer: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' },
  loadingSpinner: { width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTop: '3px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  loginContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)', padding: '20px' },
  loginCard: { backgroundColor: '#fff', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '400px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' },
  loginHeader: { textAlign: 'center', marginBottom: '24px' },
  logoIcon: { fontSize: '48px', marginBottom: '16px' },
  loginTitle: { margin: 0, fontSize: '24px', fontWeight: '700', color: '#1e293b' },
  loginSubtitle: { margin: '8px 0 0', color: '#64748b', fontSize: '14px' },
  loginTabs: { display: 'flex', gap: '8px', marginBottom: '24px' },
  loginTab: { flex: 1, padding: '12px', border: '2px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: '#64748b' },
  loginTabActive: { flex: 1, padding: '12px', border: '2px solid #1e3a5f', borderRadius: '8px', backgroundColor: '#1e3a5f', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: '#fff' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: '16px' },
  loginHelp: { margin: 0, fontSize: '14px', color: '#64748b', textAlign: 'center' },
  loginLabel: { display: 'block', marginBottom: '6px', fontWeight: '500', color: '#374151', fontSize: '14px' },
  loginInput: { width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box' },
  loginInputLarge: { width: '100%', padding: '16px 20px', border: '3px solid #3b82f6', borderRadius: '10px', fontSize: '24px', boxSizing: 'border-box', textAlign: 'center', fontWeight: '600' },
  loginBtn: { backgroundColor: '#1e3a5f', color: '#fff', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  errorText: { color: '#dc2626', fontSize: '14px', margin: '0', textAlign: 'center' },
  container: { minHeight: '100vh', backgroundColor: '#f1f5f9' },
  header: { backgroundColor: '#1e3a5f', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerIcon: { fontSize: '32px' },
  headerTitle: { margin: 0, fontSize: '20px', fontWeight: '600' },
  headerSubtitle: { margin: '2px 0 0', fontSize: '12px', opacity: '0.8' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  userBadge: { backgroundColor: 'rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: '20px', fontSize: '14px' },
  logoutBtn: { backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  nav: { backgroundColor: '#fff', padding: '12px 24px', display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  navBtn: { backgroundColor: 'transparent', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' },
  navBtnActive: { backgroundColor: '#e0f2fe', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', color: '#0369a1', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' },
  badge: { backgroundColor: '#f59e0b', color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', marginLeft: '4px' },
  badgeRed: { backgroundColor: '#ef4444', color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', marginLeft: '4px' },
  notification: { position: 'fixed', top: '80px', right: '24px', color: '#fff', padding: '12px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000 },
  main: { padding: '24px', maxWidth: '1400px', margin: '0 auto' },
  checkoutContainer: { display: 'flex', flexDirection: 'column', gap: '20px' },
  scanSection: { backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  scanLabel: { display: 'block', marginBottom: '8px', fontWeight: '600', color: '#374151', fontSize: '14px' },
  scanInput: { width: '100%', padding: '16px 20px', border: '3px solid #3b82f6', borderRadius: '10px', fontSize: '18px', boxSizing: 'border-box', backgroundColor: '#f8fafc' },
  checkoutGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  equipmentList: { backgroundColor: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  sectionTitle: { margin: '0 0 16px', fontSize: '16px', fontWeight: '600', color: '#1e293b' },
  categoryFilter: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' },
  catBtn: { backgroundColor: '#f1f5f9', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#64748b' },
  catBtnActive: { backgroundColor: '#1e3a5f', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#fff' },
  equipmentListScroll: { maxHeight: '500px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
  equipmentItem: { padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', border: '1px solid #e2e8f0' },
  eqItemMain: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
  eqId: { fontSize: '11px', fontFamily: 'monospace', backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#64748b' },
  eqName: { fontWeight: '500', color: '#1e293b' },
  eqItemSub: { display: 'flex', justifyContent: 'space-between', fontSize: '12px' },
  eqCategory: { color: '#64748b' },
  eqStatus: { fontWeight: '500', textTransform: 'capitalize' },
  actionPanel: { backgroundColor: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  selectedEquipment: { marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #e2e8f0' },
  selectedTitle: { margin: '0 0 8px', fontSize: '20px', color: '#1e293b' },
  selectedId: { margin: '0 0 12px', fontSize: '13px', color: '#64748b', fontFamily: 'monospace' },
  selectedDetail: { margin: '4px 0', fontSize: '14px', color: '#475569' },
  selectedNotes: { margin: '8px 0', fontSize: '14px', color: '#64748b', fontStyle: 'italic' },
  statusBadge: { display: 'inline-block', marginTop: '12px', padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: '600' },
  formSection: { display: 'flex', flexDirection: 'column', gap: '16px' },
  formTitle: { margin: '0 0 8px', fontSize: '16px', fontWeight: '600', color: '#1e293b' },
  formGroup: { display: 'flex', flexDirection: 'column' },
  label: { marginBottom: '6px', fontWeight: '500', color: '#374151', fontSize: '13px' },
  input: { padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' },
  select: { padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: '#fff' },
  textarea: { padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', resize: 'vertical', fontFamily: 'inherit' },
  checkoutBtn: { backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  returnBtn: { backgroundColor: '#3b82f6', color: '#fff', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  checkoutInfo: { backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '8px', marginBottom: '8px', fontSize: '13px', lineHeight: '1.6' },
  repairMessage: { textAlign: 'center', padding: '24px', backgroundColor: '#fef2f2', borderRadius: '8px' },
  repairIcon: { fontSize: '48px', display: 'block', marginBottom: '12px' },
  repairNote: { fontSize: '13px', color: '#64748b', marginTop: '8px' },
  noSelection: { textAlign: 'center', padding: '48px', color: '#94a3b8' },
  noSelectionIcon: { fontSize: '48px', display: 'block', marginBottom: '16px' },
  inventoryContainer: {},
  inventoryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' },
  pageTitle: { margin: 0, fontSize: '24px', fontWeight: '600', color: '#1e293b' },
  inventoryStats: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' },
  statBadge: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' },
  statDot: { width: '8px', height: '8px', borderRadius: '50%' },
  exportBtn: { backgroundColor: '#1e3a5f', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' },
  inventoryFilters: { display: 'flex', gap: '12px', marginBottom: '16px' },
  searchInput: { flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' },
  filterSelect: { padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: '#fff', minWidth: '150px' },
  inventoryTable: { backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '14px 16px', backgroundColor: '#f8fafc', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e2e8f0' },
  tr: { borderBottom: '1px solid #e2e8f0' },
  td: { padding: '14px 16px', fontSize: '14px', color: '#374151' },
  tableStatus: { padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', textTransform: 'capitalize' },
  qrBtn: { backgroundColor: '#f1f5f9', border: '1px solid #d1d5db', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', color: '#475569' },
  deficienciesContainer: {},
  deficienciesHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  deficiencyList: { display: 'grid', gap: '16px' },
  noDeficiencies: { textAlign: 'center', padding: '48px', backgroundColor: '#fff', borderRadius: '12px', color: '#94a3b8' },
  noDefIcon: { fontSize: '48px', display: 'block', marginBottom: '12px' },
  deficiencyCard: { backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  defHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  severityBadge: { padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' },
  defDate: { fontSize: '12px', color: '#64748b' },
  defEquipment: { margin: '0 0 8px', fontSize: '16px', color: '#1e293b' },
  defDescription: { margin: '0 0 8px', fontSize: '14px', color: '#475569', lineHeight: '1.5' },
  defReporter: { margin: '0', fontSize: '12px', color: '#94a3b8' },
  resolveBtn: { marginTop: '12px', backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  resolvedTitle: { margin: '32px 0 16px', fontSize: '16px', fontWeight: '600', color: '#64748b' },
  resolvedList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  resolvedCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '8px', fontSize: '13px' },
  resolvedEquip: { fontWeight: '500', color: '#475569' },
  resolvedDesc: { color: '#94a3b8', flex: 1, marginLeft: '16px' },
  resolvedDate: { color: '#94a3b8' },
  historyContainer: {},
  historyHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  historyTable: { backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  useTypeBadge: { padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500' },
  returnedBadge: { backgroundColor: '#dcfce7', color: '#16a34a', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500' },
  outBadge: { backgroundColor: '#fef3c7', color: '#d97706', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500' },
  overdueBadge: { backgroundColor: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500' },
  alertsContainer: {},
  alertSection: { marginBottom: '32px' },
  alertSectionTitle: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px', fontSize: '18px', fontWeight: '600', color: '#1e293b' },
  alertIcon: { fontSize: '20px' },
  noAlerts: { padding: '24px', backgroundColor: '#f0fdf4', borderRadius: '8px', color: '#16a34a', textAlign: 'center' },
  alertList: { display: 'grid', gap: '12px' },
  alertCard: { backgroundColor: '#fff', padding: '16px 20px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  alertCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  alertEquipment: { fontWeight: '600', color: '#1e293b', fontSize: '15px' },
  overdueDays: { backgroundColor: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' },
  maintenanceStatus: { padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' },
  alertDetail: { margin: '4px 0', fontSize: '13px', color: '#64748b' },
  markMaintainedBtn: { marginTop: '12px', backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  moreAlerts: { textAlign: 'center', color: '#64748b', fontSize: '13px', padding: '8px' },
  adminContainer: {},
  adminGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px', marginTop: '20px' },
  adminCard: { backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  adminCardTitle: { margin: '0 0 16px', fontSize: '16px', fontWeight: '600', color: '#1e293b' },
  adminDesc: { fontSize: '14px', color: '#64748b', lineHeight: '1.5', marginBottom: '16px' },
  addBtn: { width: '100%', backgroundColor: '#1e3a5f', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  statsList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  statRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '14px', color: '#475569' },
  exportButtonGroup: { display: 'flex', flexDirection: 'column', gap: '10px' },
  exportBtnLarge: { backgroundColor: '#f1f5f9', border: '1px solid #d1d5db', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', color: '#374151', textAlign: 'left', fontWeight: '500' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: '#fff', padding: '32px', borderRadius: '16px', textAlign: 'center', maxWidth: '360px', width: '90%' },
  modalTitle: { margin: '0 0 4px', fontSize: '18px', color: '#1e293b' },
  modalId: { margin: '0 0 20px', fontSize: '13px', color: '#64748b', fontFamily: 'monospace' },
  qrContainer: { backgroundColor: '#fff', padding: '20px', display: 'inline-block', borderRadius: '8px', border: '1px solid #e2e8f0' },
  qrInstructions: { fontSize: '13px', color: '#64748b', margin: '20px 0', lineHeight: '1.5' },
  modalButtons: { display: 'flex', gap: '12px', justifyContent: 'center' },
  printModalBtn: { backgroundColor: '#1e3a5f', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' },
  closeModalBtn: { backgroundColor: '#f1f5f9', color: '#475569', border: 'none', padding: '10px 24px', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }
}
