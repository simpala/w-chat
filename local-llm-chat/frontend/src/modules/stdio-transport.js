let StdioClientTransport;

if (typeof window === 'undefined') {
    import('@modelcontextprotocol/sdk/client/stdio.js').then(module => {
        StdioClientTransport = module.StdioClientTransport;
    });
}

export {
    StdioClientTransport
};
