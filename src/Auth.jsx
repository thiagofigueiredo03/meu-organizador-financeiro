import { useState } from 'react'
import { supabase } from './supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [modo, setModo] = useState('login') // 'login' | 'cadastro'
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)

  const handleSubmit = async () => {
    if (!email || !senha) return
    setLoading(true)
    setMsg(null)
    try {
      if (modo === 'cadastro') {
        const { error } = await supabase.auth.signUp({ email, password: senha })
        if (error) throw error
        setMsg({ tipo: 'ok', texto: 'Conta criada! Verifique seu e-mail para confirmar.' })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      }
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e.message || 'Erro ao autenticar.' })
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: '#1a1a2e', border: '1px solid #2a2a40', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: '#fff' }}>F</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#f0f0f0' }}>Meu Organizador Financeiro</span>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f0f0f0', marginBottom: 6 }}>
          {modo === 'login' ? 'Entrar' : 'Criar conta'}
        </h2>
        <p style={{ fontSize: 13, color: '#555570', marginBottom: 24 }}>
          {modo === 'login' ? 'Acesse seu organizador financeiro' : 'Crie sua conta gratuita'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ background: '#0f0f1a', border: '1px solid #2a2a40', borderRadius: 10, color: '#f0f0f0', fontSize: 14, padding: '12px 14px', outline: 'none', fontFamily: 'inherit' }}
          />
          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ background: '#0f0f1a', border: '1px solid #2a2a40', borderRadius: 10, color: '#f0f0f0', fontSize: 14, padding: '12px 14px', outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {msg && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: msg.tipo === 'ok' ? '#0d2218' : '#200d0d', color: msg.tipo === 'ok' ? '#4ade80' : '#f87171', border: `1px solid ${msg.tipo === 'ok' ? '#14532d' : '#7f1d1d'}` }}>
            {msg.texto}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !email || !senha}
          style={{ marginTop: 20, width: '100%', padding: '13px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}
        >
          {loading ? '...' : modo === 'login' ? 'Entrar' : 'Criar conta'}
        </button>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#555570' }}>
          {modo === 'login' ? 'Não tem conta? ' : 'Já tem conta? '}
          <button onClick={() => { setModo(modo === 'login' ? 'cadastro' : 'login'); setMsg(null) }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
            {modo === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </div>
    </div>
  )
}
