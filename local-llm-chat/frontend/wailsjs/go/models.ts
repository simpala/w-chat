export namespace main {

	export class Config {
	    llama_cpp_dir: string;
	    models_dir: string;
	    selected_model: string;

	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.llama_cpp_dir = source["llama_cpp_dir"];
	        this.models_dir = source["models_dir"];
	        this.selected_model = source["selected_model"];
	    }
	}

}
