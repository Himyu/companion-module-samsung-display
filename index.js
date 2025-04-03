const { InstanceBase, InstanceStatus, TCPHelper, Regex, runEntrypoint } = require('@companion-module/base')
const { combineRgb } = require('@companion-module/base')
const { decToHex } = require('hex2dec')
const { commandQueue } = require('./src/utils/commandQueue')

class SamsungDisplayInstance extends InstanceBase {
	deviceId = '0x01'
	currentInput = '0x21'
	powerState = '0x00'
	videoWallState = '0x00'
	currentVolume = '0x00'

	sendCommand = commandQueue(this._send, 1000)

	commands = {
		powerState: (state) =>
			Buffer.from(
				[0xaa, 0x11, this.deviceId, 0x01, state, this.calcCheckSum([0x11, this.deviceId, 0x01, state])],
				'latin1',
			),
		getPowerState: () => Buffer.from([0xaa, 0x11, this.deviceId, 0x00, this.calcCheckSum([0x11, this.deviceId, 0x00])]),
		switchInput: (source) =>
			Buffer.from(
				[0xaa, 0x14, this.deviceId, 0x01, source, this.calcCheckSum([0x14, this.deviceId, 0x01, source])],
				'latin1',
			),
		getInput: () => Buffer.from([0xaa, 0x14, this.deviceId, 0x00, this.calcCheckSum([0x14, this.deviceId, 0x00])]),
		videoWallSate: (state) =>
			Buffer.from([0xaa, 0x84, this.deviceId, 0x01, state, this.calcCheckSum([0x84, this.deviceId, 0x01, state])]),
		getVideoWallSate: () =>
			Buffer.from([0xaa, 0x84, this.deviceId, 0x00, this.calcCheckSum([0x84, this.deviceId, 0x00])]),
		setVolume: (volume) =>
			Buffer.from([0xaa, 0x12, this.deviceId, 0x01, volume, this.calcCheckSum([0x12, this.deviceId, 0x01, volume])]),
		getVolume: () => Buffer.from([0xaa, 0x12, this.deviceId, 0x00, this.calcCheckSum([0x12, this.deviceId, 0x00])]),
	}

	acks = {
		powerOff: Buffer.from(
			[
				0xaa,
				0xff,
				this.deviceId,
				0x03,
				0x41,
				0x11,
				0x00,
				this.calcCheckSum([0xff, this.deviceId, 0x03, 0x41, 0x11, 0x00]),
			],
			'latin1',
		),
		powerOn: Buffer.from(
			[
				0xaa,
				0xff,
				this.deviceId,
				0x03,
				0x41,
				0x11,
				0x01,
				this.calcCheckSum([0xff, this.deviceId, 0x03, 0x41, 0x11, 0x01]),
			],
			'latin1',
		),
		switchInput: Buffer.from([0xaa, 0xff, this.deviceId, 0x03, 0x41, 0x14], 'latin1'),
		videoWallOn: Buffer.from(
			[
				0xaa,
				0xff,
				this.deviceId,
				0x03,
				0x41,
				0x84,
				0x01,
				this.calcCheckSum([0xff, this.deviceId, 0x03, 0x41, 0x84, 0x01]),
			],
			'latin1',
		),
		videoWallOff: Buffer.from(
			[
				0xaa,
				0xff,
				this.deviceId,
				0x03,
				0x41,
				0x84,
				0x00,
				this.calcCheckSum([0xff, this.deviceId, 0x03, 0x41, 0x84, 0x00]),
			],
			'latin1',
		),
		setVolume: Buffer.from([0xaa, 0xff, this.deviceId, 0x03, 0x41, 0x12], 'latin1'),
	}

	init(config) {
		this.config = config
		this.init_actions()
		this.init_presets()
		this.init_feedback()
		this.init_tcp()
	}

	configUpdated(config) {
		this.config = config

		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.deviceId = config.deviceId ? decToHex(config.deviceId.toString()) : '0x01'
		this.init_tcp()
	}

	init_tcp() {
		let self = this

		if (self.socket !== undefined) {
			self.socket.destroy()
			delete self.socket
		}

		self.updateStatus(InstanceStatus.Connecting)

		if (self.config.host) {
			self.socket = new TCPHelper(self.config.host, 1515)

			self.socket.on('status_change', (status, message) => {
				self.updateStatus(status, message)
			})

			self.socket.on('error', (err) => {
				self.log('debug', 'Network error', err)
				self.log('error', 'Network error: ' + err.message)
			})

			self.socket.on('connect', async () => {
				self.log('debug', 'Connected')
				this.sendCommand(this.commands.getInput())
				this.sendCommand(this.commands.getVideoWallSate())
				this.sendCommand(this.commands.getVolume())
				this.sendCommand(this.commands.getPowerState())
			})

			self.socket.on('data', (data) => {
				// this.log('debug', data)
				if (Buffer.compare(data, this.acks.powerOff) === 0) {
					self.log('info', 'POWER OFF command received by Display')
					this.powerState = '0x00'
					this.checkFeedbacks('powerState')
				}
				if (Buffer.compare(data, this.acks.powerOn) === 0) {
					self.log('info', 'POWER ON command received by Display')
					this.powerState = '0x01'
					this.checkFeedbacks('powerState')
				}
				if (Buffer.compare(data.slice(0, 6), this.acks.switchInput) === 0) {
					self.log('info', 'Input Switch command received by Display')
					this.currentInput = data[data.length - 2]
					this.checkFeedbacks('source')
				}
				if (Buffer.compare(data.slice(0, 6), this.acks.setVolume) === 0) {
					self.log('info', 'Volume command received by Display')
					this.currentVolume = data[data.length - 2]
					this.checkFeedbacks('volume')
				}
				if (Buffer.compare(data, this.acks.videoWallOff) === 0 && this.videoWallState !== '0x00') {
					self.log('info', 'Video Wall OFF command received by Display')
					this.videoWallState = '0x00'
					this.checkFeedbacks('videoWallState')
				}
				if (Buffer.compare(data, this.acks.videoWallOn) === 0 && this.videoWallState !== '0x01') {
					self.log('info', 'Video Wall ON command received by Display')
					this.videoWallState = '0x01'
					this.checkFeedbacks('videoWallState')
				}
			})
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 6,
				regex: Regex.IP,
			},
			{
				id: 'deviceId',
				type: 'number',
				label: 'Device ID',
				default: 1,
				min: 0,
				max: 100,
			},
		]
	}

	// When module gets deleted
	destroy() {
		this.socket.destroy()

		this.log('debug', 'destroy ' + this.id)
	}

	init_presets() {
		let presets = []
		presets.push({
			category: 'Basics',
			name: 'Power on',
			type: 'button',
			style: {
				text: `Power On`,
				size: '14',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 0, 0),
			},
			steps: [
				{
					down: [
						{
							actionId: 'powerState',
							options: {
								state: 0x01,
							},
						},
					],
				},
			],
			feedbacks: [],
		})
		presets.push({
			category: 'Basics',
			name: 'Power off',
			type: 'button',
			style: {
				text: `Power Off`,
				size: '14',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 0, 0),
			},
			steps: [
				{
					down: [
						{
							actionId: 'powerState',
							options: {
								state: 0x00,
							},
						},
					],
				},
			],
			feedbacks: [],
		})
		this.setPresetDefinitions(presets)
	}

	init_feedback() {
		this.setFeedbackDefinitions({
			source: {
				type: 'boolean',
				name: 'Source',
				options: [
					{
						id: 'source',
						type: 'dropdown',
						label: 'Source',
						choices: [
							{ id: 0x60, label: 'MagicInfo' },
							{ id: 0x21, label: 'HDMI 1' },
							{ id: 0x23, label: 'HDMI 2' },
							{ id: 0x31, label: 'HDMI 3' },
							{ id: 0x25, label: 'DisplayPort' },
						],
						default: 0x21,
					},
				],
				defaultStyle: {
					bgcolor: combineRgb(255, 0, 0),
					color: combineRgb(0, 0, 0),
				},
				callback: (feedback) => {
					if (parseInt(this.currentInput) === parseInt(feedback.options.source)) {
						return true
					} else {
						return false
					}
				},
			},
			volume: {
				type: 'boolean',
				name: 'Volume',
				options: [
					{
						id: 'volume',
						type: 'number',
						min: 0,
						max: 100,
						label: 'Volume',
						default: 0,
					},
				],
				defaultStyle: {
					bgcolor: combineRgb(255, 255, 0),
					color: combineRgb(0, 0, 0),
				},
				callback: (feedback) => {
					if (parseInt(this.currentVolume) === parseInt(feedback.options.volume)) {
						return true
					} else {
						return false
					}
				},
			},
			powerState: {
				type: 'boolean',
				name: 'Power State',
				options: [
					{
						id: 'state',
						type: 'dropdown',
						label: 'State',
						choices: [
							{ id: 0x00, label: 'Off' },
							{ id: 0x01, label: 'On' },
						],
						default: 0x00,
					},
				],
				defaultStyle: {
					bgcolor: combineRgb(255, 0, 0),
					color: combineRgb(0, 0, 0),
				},
				callback: (feedback) => {
					if (parseInt(this.powerState) === parseInt(feedback.options.state)) {
						return true
					} else {
						return false
					}
				},
			},
			videoWallState: {
				type: 'boolean',
				name: 'Video Wall State',
				options: [
					{
						id: 'state',
						type: 'dropdown',
						label: 'State',
						choices: [
							{ id: 0x00, label: 'Off' },
							{ id: 0x01, label: 'On' },
						],
						default: 0x00,
					},
				],
				defaultStyle: {
					bgcolor: combineRgb(0, 0, 255),
					color: combineRgb(255, 255, 255),
				},
				callback: (feedback) => {
					if (parseInt(this.videoWallState) === parseInt(feedback.options.state)) {
						return true
					} else {
						return false
					}
				},
			},
		})
	}

	init_actions() {
		this.setActionDefinitions({
			powerState: {
				name: 'Power State',
				description: 'Switch device On or Off',
				options: [
					{
						id: 'state',
						type: 'dropdown',
						label: 'Power State',
						choices: [
							{ id: 0x00, label: 'Off' },
							{ id: 0x01, label: 'On' },
						],
						default: 0x00,
					},
				],
				callback: async (action) => {
					this.doAction(action)
				},
			},
			switchInput: {
				name: 'Switch Input',
				options: [
					{
						id: 'source',
						type: 'dropdown',
						label: 'Select Source',
						choices: [
							{ id: 0x60, label: 'MagicInfo' },
							{ id: 0x21, label: 'HDMI 1' },
							{ id: 0x23, label: 'HDMI 2' },
							{ id: 0x31, label: 'HDMI 3' },
							{ id: 0x25, label: 'DisplayPort' },
						],
						default: 0x21,
					},
				],
				callback: async (action) => {
					this.doAction(action)
				},
			},
			setVolume: {
				name: 'Set Volume',
				options: [
					{
						id: 'volume',
						type: 'number',
						label: 'Volume',
						default: 0,
					},
				],
				callback: async (action) => {
					this.doAction(action)
				},
			},
			ledWallState: {
				name: 'Video Wall State',
				description: 'Turn Video Wall feature On or Off',
				options: [
					{
						id: 'state',
						type: 'dropdown',
						label: 'State',
						choices: [
							{ id: 0x00, label: 'Off' },
							{ id: 0x01, label: 'On' },
						],
						default: 0x00,
					},
				],
				callback: async (action) => {
					this.doAction(action)
				},
			},
		})
	}

	doAction(action) {
		let cmd

		switch (action.actionId) {
			case 'powerState':
				cmd = this.commands.powerState(action.options.state)
				break
			case 'switchInput':
				cmd = this.commands.switchInput(action.options.source)
				break
			case 'ledWallState':
				cmd = this.commands.videoWallSate(action.options.state)
				break
			case 'setVolume':
				cmd = this.commands.setVolume(decToHex(action.options.volume.toString()))
				break
			default:
				this.log('debug', 'unknown action')
				break
		}

		let sendBuf = cmd

		if (sendBuf != '') {
			this.sendCommand(sendBuf)
		}
	}

	_send(buffer) {
		if (this.socket === undefined || !this.socket.isConnected) {
			this.log('debug', 'Socket not connected :(')
			return
		}

		this.log('debug', 'sending ' + buffer + ' to ' + this.config.host)
		this.socket.send(buffer)
	}

	calcCheckSum(vals) {
		const sum = vals.reduce((p, c) => p + parseInt(c), 0)
		return '0x' + sum.toString(16).slice(-2)
	}
}
runEntrypoint(SamsungDisplayInstance, [])
