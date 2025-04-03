function commandQueue(fn, delay, context) {
	let canInvoke = true,
		queue = [],
		timeout,
		limited = function () {
			queue.push({
				context: context || this,
				arguments: Array.prototype.slice.call(arguments),
			})
			if (canInvoke) {
				canInvoke = false
				timeEnd()
			}
		}
	function run(context, args) {
		fn.apply(context, args)
	}
	function timeEnd() {
		var e
		if (queue.length) {
			e = queue.splice(0, 1)[0]
			run(e.context, e.arguments)
			timeout = setTimeout(timeEnd, delay)
		} else canInvoke = true
	}
	limited.reset = function () {
		clearTimeout(timeout)
		queue = []
		canInvoke = true
	}
	return limited
}

module.exports = {
	commandQueue,
}
