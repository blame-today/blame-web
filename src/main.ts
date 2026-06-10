import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { init } from '$lib/store.svelte';
import { publishHit } from '$lib/nostr';
import { armAutoRefresh } from '$lib/auto-refresh';

const app = mount(App, { target: document.getElementById('app')! });
init(); // hydrate cache + connect to relays
publishHit(); // best-effort page-load ping to nostr for rough traffic counts
armAutoRefresh(); // reload after a max session age to reclaim long-tab memory (#6)

export default app;
