export namespace artifacts {
	
	export class Artifact {
	    id: string;
	    session_id: string;
	    type: string;
	    content_path: string;
	    url: string;
	    metadata: Record<string, any>;
	    // Go type: time
	    timestamp: any;
	    is_persistent: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Artifact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.session_id = source["session_id"];
	        this.type = source["type"];
	        this.content_path = source["content_path"];
	        this.url = source["url"];
	        this.metadata = source["metadata"];
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.is_persistent = source["is_persistent"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class ChatMessage {
	    role: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	    }
	}
	export class ChatSession {
	    id: number;
	    name: string;
	    system_prompt: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.system_prompt = source["system_prompt"];
	        this.created_at = source["created_at"];
	    }
	}

}

