export namespace main {

	export class ChatSession {
	    id: number;
	    name: string;
	    created_at: string;

	    static createFrom(source: any = {}) {
	        return new ChatSession(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.created_at = source["created_at"];
	    }
	}

}
