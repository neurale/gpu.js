const KernelBase = require('../kernel-base');
const utils = require('../../core/utils');
const kernelString = require('./kernel-string');

/**
 * Class: CPUKernel
 *
 * Kernel Implementation for CPU. 
 *
 * Extends:
 * 	KernelBase
 *
 * Parameters: 	
 *		thread 					- {Object} 		The thread dimensions, x, y and z
 *		runDimensions 			- {Object} 		The canvas dimensions
 *		functionBuilder 		- {Object} 		Function Builder instance bound to this Kernel
 *		run 					- {Function} 	Method to run the kernel
 *
 */
module.exports = class CPUKernel extends KernelBase {

	//
	// [Constructor]
	//
	
	/**
	 * Function: CPUKernel
	 *
	 * Instantiates properties to the CPU Kernel.
	 *
	 */
	constructor(fnString, settings) {
		super(fnString, settings);
		this._fnBody = utils.getFunctionBodyFromString(fnString);
		this.functionBuilder = settings.functionBuilder;
		this._fn = null;
		this.run = null;
		this._canvasCtx = null;
		this._imageData = null;
		this._colorData = null;
		this._kernelString = null;
		this.thread = {
			x: 0,
			y: 0,
			z: 0
		};
		this.runDimensions = {
			x: null,
			y: null,
			z: null
		};

		this.run = function() {
			this.run = null;
			this.build();
			return this.run.apply(this, arguments);
		}.bind(this);
	}

	/**
	 * Function: validateOptions
	 * 
	 * Validate options related to CPU Kernel, such as 
	 * dimensions size, and auto dimension support.
	 *
	 */
	validateOptions() {
		if (!this.dimensions || this.dimensions.length === 0) {
			if (arguments.length !== 1) {
				throw 'Auto dimensions only supported for kernels with only one input';
			}

			const argType = utils.getArgumentType(arguments[0]);
			if (argType === 'Array') {
				this.dimensions = utils.getDimensions(argType);
			} else if (argType === 'Texture') {
				this.dimensions = arguments[0].dimensions;
			} else {
				throw 'Auto dimensions not supported for input type: ' + argType;
			}
		}
	}	
	
	/**
	 * Function: build
	 *
	 * Builds the Kernel, by generating the kernel 
	 *	string using thread dimensions, and arguments 
	 *	supplied to the kernel.
	 *
	 * If the graphical flag is enabled, canvas is used.
	 *
	 */
	build() {

		//
		// NOTE: these are optional safety checks
		//       does not actually do anything
		//
		const kernelArgs = [];
		for (let i = 0; i < arguments.length; i++) {
			const argType = utils.getArgumentType(arguments[i]);
			if (argType === 'Array' || argType === 'Number') {
				kernelArgs[i] = arguments[i];
			} else if (argType === 'Texture') {
				kernelArgs[i] = arguments[i].toArray();
			} else {
				throw 'Input type not supported (CPU): ' + arguments[i];
			}
		}

		const threadDim = this.threadDim || (this.threadDim = utils.clone(this.dimensions));

		while (threadDim.length < 3) {
			threadDim.push(1);
		}

		if (this.graphical) {
			const canvas = this.getCanvas();
			this.runDimensions.x = canvas.width = threadDim[0];
			this.runDimensions.y = canvas.height = threadDim[1];
			this._canvasCtx = canvas.getContext('2d');
			this._imageData = this._canvasCtx.createImageData(threadDim[0], threadDim[1]);
			this._colorData = new Uint8ClampedArray(threadDim[0] * threadDim[1] * 4);
		}

		const kernelString = this.getKernelString();

		if (this.debug) {
			console.log('Options:');
			console.dir(this);
			console.log('Function output:');
			console.log(kernelString);
		}

		this.kernelString = kernelString;
		this.run = new Function([], kernelString).bind(this)();
	}

	color(r, g, b, a) {
		if (typeof a === 'undefined') {
			a = 1;
		}

		r = Math.floor(r * 255);
		g = Math.floor(g * 255);
		b = Math.floor(b * 255);
		a = Math.floor(a * 255);

		const width = this.runDimensions.x;
		const height = this.runDimensions.y;

		const x = this.thread.x;
		const y = height - this.thread.y - 1;

		const index = x + y * width;
		
		this._colorData[index * 4 + 0] = r;
		this._colorData[index * 4 + 1] = g;
		this._colorData[index * 4 + 2] = b;
		this._colorData[index * 4 + 3] = a;
	}

	/**
	 * Function: getKernelString
	 *
	 * Generates kernel string for this kernel program.
	 * 
	 * If sub-kernels are supplied, they are also factored in.
	 * This string can be saved by calling the `toString` method
	 * and then can be reused later.
	 *
	 * Returns:
	 *		result {String}
	 *
	 */
	getKernelString() {
		if (this._kernelString !== null) return this._kernelString;

		const paramNames = this.paramNames;
		const builder = this.functionBuilder;

		// Thread dim fix (to make compilable)
		const threadDim = this.threadDim || (this.threadDim = utils.clone(this.dimensions));
		while (threadDim.length < 3) {
			threadDim.push(1);
		}

		if (this.subKernels !== null) {
			this.subKernelOutputTextures = [];
			this.subKernelOutputVariableNames = [];
			for (let i = 0; i < this.subKernels.length; i++) {
				const subKernel = this.subKernels[i];
				builder.addSubKernel(subKernel);
				this.subKernelOutputVariableNames.push(subKernel.name + 'Result');
			}

		} else if (this.subKernelProperties !== null) {
			this.subKernelOutputVariableNames = [];
			let i = 0;
			for (let p in this.subKernelProperties) {
				if (!this.subKernelProperties.hasOwnProperty(p)) continue;
				const subKernel = this.subKernelProperties[p];
				builder.addSubKernel(subKernel);
				this.subKernelOutputVariableNames.push(subKernel.name + 'Result');
				i++;
			}
		}

		return this._kernelString = `
  ${ this.constants ? Object.keys(this.constants).map((key) => { return `var ${ key } = ${ this.constants[key] }`; }).join(';\n') + ';\n' : '' }
  ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `  var ${ name } = null;\n`).join('')
        }
      ${ builder.getPrototypeString() }
      var fn = function fn(${ this.paramNames.join(', ') }) { ${ this._fnBody } }.bind(this);
    return function (${ this.paramNames.join(', ') }) {
    var ret = new Array(${ threadDim[2] });
  ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `  ${ name } = new Array(${ threadDim[2] });\n`).join('')
        }
    for (this.thread.z = 0; this.thread.z < ${ threadDim[2] }; this.thread.z++) {
      ret[this.thread.z] = new Array(${ threadDim[1] });
  ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `    ${ name }[this.thread.z] = new Array(${ threadDim[1] });\n`).join('')
        }
      for (this.thread.y = 0; this.thread.y < ${ threadDim[1] }; this.thread.y++) {
        ret[this.thread.z][this.thread.y] = new Array(${ threadDim[0] });
  ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `      ${ name }[this.thread.z][this.thread.y] = new Array(${ threadDim[0] });\n`).join('')
        }
        for (this.thread.x = 0; this.thread.x < ${ threadDim[0] }; this.thread.x++) {
          ret[this.thread.z][this.thread.y][this.thread.x] = fn(${ this.paramNames.join(', ') });
        }
      }
    }
    
    if (this.graphical) {
      this._imageData.data.set(this._colorData);
      this._canvasCtx.putImageData(this._imageData, 0, 0);
      return;
    }
    
    if (this.dimensions.length === 1) {
      ret = ret[0][0];
      ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `    ${ name } = ${ name }[0][0];\n`).join('')
        }
      
    } else if (this.dimensions.length === 2) {
      ret = ret[0];
      ${ this.subKernelOutputVariableNames === null
        ? ''
        : this.subKernelOutputVariableNames.map((name) => `    ${ name } = ${ name }[0];\n`).join('')
        }
    }
    
    ${ this.subKernelOutputVariableNames === null
        ? 'return ret;\n'
        : this.subKernels !== null
          ? `var result = [
        ${ this.subKernelOutputVariableNames.map((name) => `${ name }`).join(',\n') }
      ];
      result.result = ret;
      return result;\n`
          : `return {
        result: ret,
        ${ Object.keys(this.subKernelProperties).map((name, i) => `${ name }: ${ this.subKernelOutputVariableNames[i] }`).join(',\n') }
      };`
        }
    }.bind(this);`;
	}

	/**
	 * Function: toString
	 *
	 * Returns the *pre-compiled* Kernel as a JS Object String, that can be reused.
	 *
	 */
	toString() {
		return kernelString(this);
	}

	/**
	 * Function: precompileKernelObj
	 *
	 * Precompile the kernel into a single object, 
	 * that can be used for building the execution kernel subsequently.
	 *
	 * Parameters:
	 *     argTypes     - {Array}    Array of argument types
	 *     
	 * Return:
	 *     Compiled kernel {Object}
	 *
	 */
	precompileKernelObj(argTypes) {

		const threadDim = this.threadDim || (this.threadDim = utils.clone(this.dimensions));


		return {
			threadDim : threadDim
		};
	}
	
	/**
	 * Function: compileKernel
	 * 
	 * Takes a previously precompiled kernel object,
	 * and complete compilation into a full kernel
	 *
	 * Return:
	 *     Compiled kernel {Function}
	 *
	 */
	static compileKernel( precompileObj ) {

		// Extract values from precompiled obj
		const threadDim = precompileObj.threadDim;

		// Normalize certain values : For actual build
		while (threadDim.length < 3) {
			threadDim.push(1);
		}

	}


};