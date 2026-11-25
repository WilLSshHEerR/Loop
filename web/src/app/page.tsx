'use client';

import { FormEvent, useState } from 'react';
import { apiRequest } from '@/lib/api';
import styles from './page.module.css';

type Prospect = { id: string; businessName: string; category: string | null; city: string | null; state: string | null; status: string; email: string | null; phone: string | null };
type PendingMessage = { id: string; subject: string | null; body: string; conversation: { prospect: Prospect } };
const TOKEN_KEY = 'loop_access_token';

export default function Home() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(() => typeof window === 'undefined' ? null : sessionStorage.getItem(TOKEN_KEY));
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'prospects' | 'approvals' | 'discovery'>('prospects');
  const [searchText, setSearchText] = useState('consultorio dental');
  const [searchCity, setSearchCity] = useState('');
  const [searchState, setSearchState] = useState('');

  const loadData = async (accessToken: string) => {
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ items: Prospect[] }>('/prospects?limit=20', accessToken);
      setProspects(result.items);
      const approvals = await apiRequest<{ items: PendingMessage[] }>('/approvals/pending?limit=20', accessToken);
      setPending(approvals.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la información'); }
    finally { setLoading(false); }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await apiRequest<{ accessToken: string }>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username, password }) });
      sessionStorage.setItem(TOKEN_KEY, result.accessToken); setToken(result.accessToken); setPassword(''); await loadData(result.accessToken);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible iniciar sesión'); }
    finally { setLoading(false); }
  };

  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); setProspects([]); setPending([]); };

  const discover = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setLoading(true); setError('');
    try {
      await apiRequest('/discovery/search', token, { method: 'POST', body: JSON.stringify({ text: searchText, city: searchCity || undefined, state: searchState || undefined, limit: 20 }) });
      await loadData(token);
      setView('prospects');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible buscar prospectos'); }
    finally { setLoading(false); }
  };

  const decide = async (messageId: string, decision: 'approve' | 'reject') => {
    if (!token) return; setLoading(true); setError('');
    try { await apiRequest(`/approvals/${messageId}/${decision}`, token, { method: 'POST', body: '{}' }); await loadData(token); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la aprobación'); }
    finally { setLoading(false); }
  };

  if (!token) return (
    <main className={styles.loginPage}><section className={styles.loginCard}><div className={styles.brandMark}>L</div><p className={styles.eyebrow}>Dn Craft &amp; Loop</p><h1>Loop</h1><p className={styles.loginSubtitle}>Panel operativo de ventas</p>
      <form onSubmit={login} className={styles.loginForm}><label>Usuario<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label><label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className={styles.error}>{error}</p>}<button type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button></form>
    </section></main>
  );

  return (
    <main className={styles.shell}><aside className={styles.sidebar}><div><div className={styles.logoRow}><div className={styles.brandMark}>L</div><strong>Loop</strong></div><nav><button className={view === 'discovery' ? styles.activeNav : ''} onClick={() => setView('discovery')}>Descubrir</button><button className={view === 'prospects' ? styles.activeNav : ''} onClick={() => setView('prospects')}>Prospectos</button><button className={view === 'approvals' ? styles.activeNav : ''} onClick={() => setView('approvals')}>Aprobaciones <span>{pending.length}</span></button></nav></div><button className={styles.logout} onClick={logout}>Cerrar sesión</button></aside>
      <section className={styles.content}><header className={styles.header}><div><p className={styles.eyebrow}>Dn Craft &amp; Loop</p><h1>{view === 'prospects' ? 'Prospectos' : view === 'discovery' ? 'Descubrir prospectos' : 'Aprobaciones'}</h1></div><button className={styles.refresh} onClick={() => token && loadData(token)} disabled={loading}>Actualizar</button></header>{error && <p className={styles.error}>{error}</p>}
        {view === 'discovery' ? <form className={styles.discoveryForm} onSubmit={discover}><label>Consulta<input value={searchText} onChange={(event) => setSearchText(event.target.value)} required /></label><label>Ciudad<input value={searchCity} onChange={(event) => setSearchCity(event.target.value)} placeholder='Ej. Ciudad de México' /></label><label>Estado<input value={searchState} onChange={(event) => setSearchState(event.target.value)} placeholder='Ej. Estado de México' /></label>{error && <p className={styles.error}>{error}</p>}<button type='submit' disabled={loading}>{loading ? 'Buscando…' : 'Buscar con Google Places'}</button></form> : view === 'prospects' ? <><div className={styles.summary}><strong>{prospects.length} prospectos</strong><span>Datos desde Loop API</span></div><div className={styles.tableWrap}><table><thead><tr><th>Negocio</th><th>Ciudad</th><th>Estado</th><th>Contacto</th></tr></thead><tbody>{prospects.map((prospect) => <tr key={prospect.id}><td><strong>{prospect.businessName}</strong><small>{prospect.category ?? 'Sin categoría'}</small></td><td>{prospect.city ?? '—'}<small>{prospect.state ?? ''}</small></td><td><span className={styles.status}>{prospect.status}</span></td><td>{prospect.email ?? prospect.phone ?? '—'}</td></tr>)}</tbody></table>{!loading && prospects.length === 0 && <p className={styles.empty}>No hay prospectos disponibles.</p>}</div></> : <div className={styles.approvals}>{pending.map((message) => <article key={message.id} className={styles.messageCard}><div><p className={styles.eyebrow}>{message.conversation.prospect.businessName}</p><h2>{message.subject ?? 'Sin asunto'}</h2><p>{message.body}</p></div><div className={styles.actions}><button className={styles.reject} onClick={() => decide(message.id, 'reject')} disabled={loading}>Rechazar</button><button className={styles.approve} onClick={() => decide(message.id, 'approve')} disabled={loading}>Aprobar</button></div></article>)}</div>}
      </section>
    </main>
  );
}
