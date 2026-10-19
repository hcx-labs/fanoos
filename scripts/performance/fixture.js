(() => {
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#29435e"/><stop offset="1" stop-color="#c28140"/></linearGradient></defs><path fill="url(#g)" d="M0 0h640v360H0z"/></svg>');
    const channels = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, backend: 'youtube', provider: 'youtube', name: 'Channel ' + i, avatar: image, unseen: 20, description: 'Test channel', subscribers: 5000 }));
    const videos = Array.from({ length: 600 }, (_, i) => ({ id: 'v' + i, backend: 'youtube', provider: 'youtube', title: 'Performance test video ' + i, channelId: 'c' + i % 30, channelName: 'Channel ' + i % 30, channelAvatar: image, duration: 600, views: 1234, published: new Date(Date.now() - i * 3600000).toISOString(), description: 'A repeatable local performance fixture.', thumbnail: image, category: i % 2 ? 'Science' : 'Technology', chapters: [{ start: 0, title: 'Intro' }, { start: 100, title: 'Middle' }, { start: 300, title: 'End' }] }));
    const backend = { id: 'b', slug: 'youtube', kind: 'youtube', label: 'YouTube', info: { name: 'YouTube', color: '#f00', features: [], urls: {}, link: { configured: true, can: [], cannot: [] }, nouns: { channel: 'channel', channels: 'channels', video: 'video', videos: 'videos', follow: 'Subscribe', following: 'Subscriptions' } } };
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/'))
            return realFetch(input, init);
        const p = url.pathname.slice(4);
        let data = [];
        if (p === '/auth/me')
            data = { profile: { id: 'perf', name: 'Perf', email: 'perf@example.invalid' }, backends: [backend], accounts: [{ id: 'a', backendId: 'b', provider: 'youtube', label: 'Test', name: 'Test', email: 'perf@example.invalid', inFeed: true, canWrite: false }], defaultAccountId: 'a' };
        else if (p === '/me/data')
            data = { data: null };
        else if (p === '/following')
            data = channels;
        else if (p === '/feed' || p === '/calendar')
            data = videos;
        else if (p === '/me/stats')
            data = { totals: { seconds: 0 }, since: null };
        else if (p === '/search')
            data = [{ backend: 'youtube', videos: videos.slice(0, 100), channels: [], playlists: [] }];
        else if (p.startsWith('/v/youtube/videos/')) {
            const v = videos.find(v => v.id === p.split('/').at(-1)) || videos[0];
            data = { video: v, channel: channels.find(c => c.id === v.channelId), next: videos.slice(1, 41), stream: {} };
        }
        else if (p.endsWith('/followers'))
            data = [];
        else if (p.startsWith('/v/youtube/channels/'))
            data = { channel: channels[0], videos: videos.slice(0, 100) };
        return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    };
})();
