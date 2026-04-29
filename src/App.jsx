import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import Auth from './Auth'

const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const CATEGORIAS = {
  fixos:      { label: 'Gastos Fixos',    cor: '#818cf8' },
  mercado:    { label: 'Mercado',         cor: '#f59e0b' },
  saude:      { label: 'Saúde',           cor: '#10b981' },
  transporte: { label: 'Transporte',      cor: '#3b82f6' },
  educacao:   { label: 'Educação',        cor: '#06b6d4' },
  pontuais:   { label: 'Gastos Pontuais', cor: '#f87171' },
}

function getMesAtual() {
  const d = new Date()
  return `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function mesLabel(mesAno) {
  const [m, a] = mesAno.split('/')
  return `${MESES_PT[parseInt(m)-1]} ${a}`
}

function mesAbrev(mesAno) {
  const [m, a] = mesAno.split('/')
  return `${MESES_PT[parseInt(m)-1].substring(0,3)}/${a.substring(2)}`
}

function resolverDataVencimento(ddmm) {
  const [d, m] = ddmm.split('/').map(Number)
  const hoje = new Date()
  let data = new Date(hoje.getFullYear(), m-1, d)
  if (data < hoje) data = new Date(hoje.getFullYear(), m, d)
  return data
}

async function interpretarMensagem(texto) {
  const hoje = new Date()
  const dia = hoje.getDate()
  const mes = hoje.getMonth()+1
  const mesStr = String(mes).padStart(2,'0')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `Você é um assistente financeiro pessoal brasileiro. Hoje é dia ${dia}/${mesStr}/${hoje.getFullYear()}.

Extraia TODAS as transações e retorne APENAS JSON válido sem markdown:
{
  "transacoes": [
    {
      "tipo": "saida" | "entrada",
      "valor": number,
      "categoria": "fixos" | "mercado" | "saude" | "transporte" | "educacao" | "pontuais" | "receita",
      "descricao": "descrição curta",
      "vencimento": "DD/MM" | null
    }
  ],
  "ignorados": [],
  "resposta": "resumo amigável em português"
}

REGRAS DE VENCIMENTO: formato DD/MM. Se o dia já passou no mês ${mesStr}, use o próximo mês.

REGRAS DE CLASSIFICAÇÃO:
"fixos" → aluguel, condomínio, água, luz, internet, celular, academia, natação, streaming, seguros, mensalidades, assessoria, plano de saúde
"mercado" → supermercado, feira, hortifruti, alimentação base
"saude" → medicamentos terapêuticos, consultas, exames, dentista, fisioterapia
"transporte" → uber, taxi, combustível, pedágio, passagem
"educacao" → cursos, livros (se não for fixo recorrente)
"pontuais" → tudo discricionário: açaí, lanchonete, restaurante, delivery, doces, compras por impulso. Na dúvida, use pontuais.
"receita" → qualquer entrada de dinheiro

Nunca invente valores.`,
      messages: [{ role: 'user', content: texto }],
    }),
  })
  const data = await res.json()
  const raw = data.content?.[0]?.text || '{}'
  return JSON.parse(raw.replace(/```json|```/g, '').trim())
}

export default function App() {
  const [session, setSession] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [transacoes, setTransacoes] = useState([])
  const [saldoAcumulado, setSaldoAcumulado] = useState(0)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [aba, setAba] = useState('dashboard')
  const inputRef = useRef(null)
  const mesAtual = getMesAtual()

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCarregando(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Carrega dados do usuário
  useEffect(() => {
    if (!session) return
    carregarDados()
  }, [session])

  const carregarDados = async () => {
    const uid = session.user.id

    const { data: ts } = await supabase
      .from('transacoes')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })

    const { data: saldo } = await supabase
      .from('saldo_usuario')
      .select('saldo_acumulado')
      .eq('user_id', uid)
      .single()

    setTransacoes(ts || [])
    setSaldoAcumulado(saldo?.saldo_acumulado || 0)

    // Replica fixos do mês anterior se não houver nenhum no mês atual
    const fixosMesAtual = (ts || []).filter(t => t.mes === mesAtual && t.categoria === 'fixos')
    if (fixosMesAtual.length === 0) {
      const [m, a] = mesAtual.split('/').map(Number)
      const mesAnt = m === 1 ? `12/${a-1}` : `${String(m-1).padStart(2,'0')}/${a}`
      const fixosAnteriores = (ts || []).filter(t => t.mes === mesAnt && t.categoria === 'fixos')
      if (fixosAnteriores.length > 0) {
        const replicados = fixosAnteriores.map(t => ({
          user_id: uid,
          tipo: t.tipo, valor: t.valor, categoria: t.categoria,
          descricao: t.descricao, vencimento: t.vencimento,
          mes: mesAtual, data: new Date().toLocaleDateString('pt-BR'),
          hora: '00:00', replicado: true,
        }))
        const { data: novos } = await supabase.from('transacoes').insert(replicados).select()
        if (novos) setTransacoes(prev => [...novos, ...prev])
      }
    }
  }

  const processar = async () => {
    const texto = input.trim()
    if (!texto || loading) return
    setLoading(true)
    setFeedback(null)
    try {
      const result = await interpretarMensagem(texto)
      const validas = (result.transacoes || []).filter(t => t.valor > 0)
      if (validas.length > 0) {
        const uid = session.user.id
        const novas = validas.map(t => ({
          user_id: uid,
          tipo: t.tipo, valor: t.valor, categoria: t.categoria,
          descricao: t.descricao, vencimento: t.vencimento || null,
          mes: mesAtual,
          data: new Date().toLocaleDateString('pt-BR'),
          hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          replicado: false,
        }))

        const { data: inseridas } = await supabase.from('transacoes').insert(novas).select()

        // Atualiza saldo
        const deltaReceitas = validas.filter(t => t.categoria === 'receita').reduce((a, t) => a + t.valor, 0)
        const deltaSaidas = validas.filter(t => t.categoria !== 'receita').reduce((a, t) => a + t.valor, 0)
        const novoSaldo = Number(saldoAcumulado) + deltaReceitas - deltaSaidas

        await supabase.from('saldo_usuario').upsert({ user_id: uid, saldo_acumulado: novoSaldo, updated_at: new Date().toISOString() })

        setTransacoes(prev => [...(inseridas || []), ...prev])
        setSaldoAcumulado(novoSaldo)
        setFeedback({ tipo: 'ok', msg: result.resposta || `${validas.length} item(ns) registrado(s).`, ignorados: result.ignorados || [] })
        setInput('')
      } else {
        setFeedback({ tipo: 'aviso', msg: result.resposta || 'Não encontrei transações com valor definido.', ignorados: [] })
      }
    } catch {
      setFeedback({ tipo: 'erro', msg: 'Erro de conexão. Tente novamente.' })
    }
    setLoading(false)
    inputRef.current?.focus()
  }

  const sair = () => supabase.auth.signOut()

  if (carregando) return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555570', fontFamily: 'sans-serif' }}>Carregando...</p>
    </div>
  )

  if (!session) return <Auth />

  const transacoesMes = transacoes.filter(t => t.mes === mesAtual)
  const receitasMes   = transacoesMes.filter(t => t.categoria === 'receita')
  const saidasMes     = transacoesMes.filter(t => t.categoria !== 'receita')

  const totalReceitasMes = receitasMes.reduce((a, t) => a + Number(t.valor), 0)
  const totalSaidasMes   = saidasMes.reduce((a, t) => a + Number(t.valor), 0)

  const ordemCats = ['fixos','mercado','saude','transporte','educacao','pontuais']
  const porCategoria = ordemCats
    .map(cat => ({
      cat, info: CATEGORIAS[cat],
      itens: saidasMes.filter(t => t.categoria === cat),
      total: saidasMes.filter(t => t.categoria === cat).reduce((a, t) => a + Number(t.valor), 0),
    }))
    .filter(({ itens }) => itens.length > 0)

  const comVencimento = transacoes
    .filter(t => t.vencimento && t.categoria !== 'receita')
    .sort((a, b) => resolverDataVencimento(a.vencimento) - resolverDataVencimento(b.vencimento))

  const totalVencimentos = comVencimento.reduce((a, t) => a + Number(t.valor), 0)
  const porData = comVencimento.reduce((acc, t) => {
    if (!acc[t.vencimento]) acc[t.vencimento] = []
    acc[t.vencimento].push(t)
    return acc
  }, {})
  const datasOrdenadas = Object.keys(porData).sort((a, b) => resolverDataVencimento(a) - resolverDataVencimento(b))

  const mesesNoHistorico = [...new Set(transacoes.map(t => t.mes))].sort((a, b) => {
    const [ma, aa] = a.split('/').map(Number)
    const [mb, ab] = b.split('/').map(Number)
    return (ab*100+mb) - (aa*100+ma)
  })

  const feedbackStyle = {
    ok:    { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    aviso: { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
    erro:  { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
  }

  const CardCategoria = ({ info, itens, total }) => (
    <div style={{ background: '#1a1a2e', border: '1px solid #2a2a40', borderRadius: 16, padding: '20px 22px' }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f0f0f0', marginBottom: 16, borderLeft: `3px solid ${info.cor}`, paddingLeft: 10 }}>{info.label}</h3>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {itens.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < itens.length-1 ? '1px solid #22223a' : 'none' }}>
            <p style={{ fontSize: 13, color: t.replicado ? '#555570' : '#c8c8d8', flex: 1, paddingRight: 12 }}>{t.descricao}{t.replicado ? ' ↺' : ''}</p>
            <span style={{ fontSize: 13, color: '#e0e0f0', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{fmt(t.valor)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid #2a2a40' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#555570' }}>Total</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: info.cor, fontFamily: "'DM Mono', monospace" }}>{fmt(total)}</span>
      </div>
    </div>
  )

  const tabs = [['dashboard','Dashboard'],['vencimentos','Próximos Vencimentos'],['historico','Histórico']]

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#f0f0f0', fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: '#13131f', borderBottom: '1px solid #1e1e30', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#fff' }}>F</div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.03em' }}>Meu Organizador Financeiro</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: '#6366f1', background: '#1e1e3a', padding: '2px 10px', borderRadius: 6, fontWeight: 600 }}>{mesLabel(mesAtual)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setAba(id)} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: aba === id ? '#6366f1' : 'transparent', color: aba === id ? '#fff' : '#666680', transition: 'all .2s' }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={sair} style={{ marginLeft: 8, padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a40', background: 'transparent', color: '#555570', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Sair</button>
        </div>
      </div>

      {/* Input */}
      <div style={{ background: '#13131f', borderBottom: '1px solid #1e1e30', padding: '16px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processar() }}}
              placeholder={"Descreva em linguagem natural:\n\"Aluguel R$300 vence dia 10. Mercado R$1000 mensal. Recebi R$3000 de salário.\""}
              rows={3}
              style={{ flex: 1, background: '#0f0f1a', border: '1px solid #2a2a40', borderRadius: 12, color: '#f0f0f0', fontSize: 14, padding: '11px 14px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
            <button onClick={processar} disabled={!input.trim() || loading}
              style={{ padding: '0 22px', height: 48, borderRadius: 12, border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', background: input.trim() && !loading ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#1e1e30', color: input.trim() && !loading ? '#fff' : '#44445a', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0, transition: 'all .2s' }}>
              {loading ? '...' : 'Enviar'}
            </button>
          </div>
          {feedback && (() => {
            const s = feedbackStyle[feedback.tipo]
            return (
              <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                {feedback.msg}
                {feedback.ignorados?.length > 0 && <p style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>Ignorado: {feedback.ignorados.join(', ')}</p>}
              </div>
            )
          })()}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 60px' }}>

        {/* DASHBOARD */}
        {aba === 'dashboard' && (
          <>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
              <div style={{ background: '#1a1a2e', border: `1px solid ${Number(saldoAcumulado) >= 0 ? '#2a4a2a' : '#4a2a2a'}`, borderRadius: 14, padding: '18px 28px', minWidth: 180 }}>
                <p style={{ color: '#555570', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Saldo Total</p>
                <p style={{ fontSize: 26, fontWeight: 700, color: Number(saldoAcumulado) >= 0 ? '#4ade80' : '#f87171', fontFamily: "'DM Mono', monospace" }}>{fmt(saldoAcumulado)}</p>
              </div>
              <div style={{ width: 1, background: '#2a2a40', alignSelf: 'stretch' }} />
              {[
                { label: 'Receitas', abrev: mesAbrev(mesAtual), valor: totalReceitasMes, cor: '#4ade80' },
                { label: 'Saídas',   abrev: mesAbrev(mesAtual), valor: totalSaidasMes,   cor: '#f87171' },
              ].map(({ label, abrev, valor, cor }) => (
                <div key={label} style={{ padding: '4px 16px' }}>
                  <p style={{ color: '#555570', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    {label} <span style={{ color: '#3a3a55' }}>{abrev}</span>
                  </p>
                  <p style={{ fontSize: 16, fontWeight: 600, color: cor, fontFamily: "'DM Mono', monospace" }}>{fmt(valor)}</p>
                </div>
              ))}
            </div>

            {transacoesMes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}>
                <p style={{ fontSize: 15, color: '#555570' }}>Nenhum lançamento em {mesLabel(mesAtual)}</p>
                <p style={{ fontSize: 13, color: '#3a3a55', marginTop: 6 }}>Pode mandar vários lançamentos de uma vez</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {porCategoria.map(({ cat, info, itens, total }) => (
                  <CardCategoria key={cat} info={info} itens={itens} total={total} />
                ))}
              </div>
            )}
          </>
        )}

        {/* PRÓXIMOS VENCIMENTOS */}
        {aba === 'vencimentos' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Próximas Contas</h2>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, color: '#555570', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Total Previsto</p>
                <p style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>{fmt(totalVencimentos)}</p>
              </div>
            </div>
            {datasOrdenadas.length === 0 ? (
              <p style={{ color: '#555570', fontSize: 14, textAlign: 'center', padding: 60 }}>Nenhuma conta com vencimento registrada.</p>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 1, background: '#2a2a40' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                  {datasOrdenadas.map(data => {
                    const dataResolvida = resolverDataVencimento(data)
                    const mesNome = MESES_PT[dataResolvida.getMonth()]
                    return (
                      <div key={data} style={{ position: 'relative', paddingLeft: 28 }}>
                        <div style={{ position: 'absolute', left: 0, top: 4, width: 13, height: 13, borderRadius: '50%', background: '#0f0f1a', border: '2px solid #6366f1' }} />
                        <p style={{ fontSize: 13, color: '#666680', fontWeight: 600, marginBottom: 10 }}>
                          {data} <span style={{ fontSize: 11, color: '#3a3a55', fontWeight: 400 }}>{mesNome}</span>
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {porData[data].map(t => (
                            <div key={t.id} style={{ background: '#1a1a2e', borderRadius: 12, padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #2a2a40' }}>
                              <p style={{ fontSize: 14, color: '#e0e0f0', fontWeight: 500 }}>{t.descricao}</p>
                              <p style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', fontFamily: "'DM Mono', monospace", flexShrink: 0, marginLeft: 20 }}>{fmt(t.valor)}</p>
                            </div>
                          ))}
                        </div>
                        {porData[data].length > 1 && (
                          <p style={{ fontSize: 12, color: '#555570', textAlign: 'right', marginTop: 6 }}>
                            Subtotal: {fmt(porData[data].reduce((a, t) => a + Number(t.valor), 0))}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HISTÓRICO */}
        {aba === 'historico' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {mesesNoHistorico.map(mes => {
              const ts = transacoes.filter(t => t.mes === mes)
              if (ts.length === 0) return null
              const recMes = ts.filter(t => t.categoria === 'receita').reduce((a, t) => a + Number(t.valor), 0)
              const saiMes = ts.filter(t => t.categoria !== 'receita').reduce((a, t) => a + Number(t.valor), 0)
              return (
                <div key={mes} style={{ background: '#1a1a2e', border: '1px solid #2a2a40', borderRadius: 16, padding: '22px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>{mesLabel(mes)}</h3>
                    <div style={{ display: 'flex', gap: 20 }}>
                      <span style={{ fontSize: 12, color: '#4ade80', fontFamily: "'DM Mono', monospace" }}>+{fmt(recMes)}</span>
                      <span style={{ fontSize: 12, color: '#f87171', fontFamily: "'DM Mono', monospace" }}>-{fmt(saiMes)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {ts.map(t => {
                      const info = t.categoria === 'receita' ? { label: 'Receita', cor: '#4ade80' } : (CATEGORIAS[t.categoria] || CATEGORIAS.pontuais)
                      return (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', background: '#13131f', borderRadius: 8, borderLeft: `3px solid ${info.cor}` }}>
                          <div>
                            <p style={{ fontSize: 13, color: '#e0e0f0', fontWeight: 500 }}>{t.descricao}</p>
                            <p style={{ fontSize: 11, color: '#555570', marginTop: 1 }}>{info.label} · {t.data}</p>
                          </div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: t.categoria === 'receita' ? '#4ade80' : '#f87171', fontFamily: "'DM Mono', monospace", flexShrink: 0, marginLeft: 16 }}>
                            {t.categoria === 'receita' ? '+' : '−'}{fmt(t.valor)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {mesesNoHistorico.length === 0 && (
              <p style={{ color: '#555570', fontSize: 14, textAlign: 'center', padding: 60 }}>Nenhuma transação ainda.</p>
            )}
          </div>
        )}
      </div>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } textarea:focus { border-color: #6366f1 !important; outline: none; } input:focus { border-color: #6366f1 !important; outline: none; }`}</style>
    </div>
  )
}
