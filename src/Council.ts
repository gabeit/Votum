import { Collection, GuildMember, Snowflake, TextChannel } from "discord.js"
import * as fs from "fs"
import onChange from "on-change"
import * as path from "path"
import { CouncilData, DefaultCouncilData } from "./CouncilData"
import Motion from "./Motion"
import { MotionData } from "./MotionData"

export interface CouncilWeights {
  users: { [index: string]: number }
  total: number
}

export default class Council {
  private static defaultData = DefaultCouncilData

  public id: Snowflake
  public channel: TextChannel
  private data: CouncilData
  private dataPath: string

  constructor(channel: TextChannel) {
    this.channel = channel
    this.id = channel.id

    this.dataPath = path.join(__dirname, `../data/${this.id}.json`)
    this.loadData()
  }

  public get enabled() {
    return this.data.enabled
  }

  public set enabled(state: boolean) {
    this.data.enabled = state
  }

  public get name() {
    return this.data.name
  }

  public set name(state: string) {
    this.data.name = state
  }

  public get announceChannel(): string | undefined {
    return this.data.announceChannel
  }

  public get councilorRole(): Snowflake | undefined {
    return this.data.councilorRole
  }

  public get userCooldown(): number {
    return this.data.userCooldown
  }

  public get motionExpiration(): number {
    return this.data.motionExpiration
  }

  public setConfig<T extends keyof CouncilData>(key: T, value: CouncilData[T]) {
    this.data[key] = value
  }

  public getConfig<T extends keyof CouncilData>(key: T): CouncilData[T] {
    return this.data[key]
  }

  public get mentionString() {
    if (this.data.councilorRole) {
      return `<@&${this.data.councilorRole}>`
    }

    return ""
  }

  public get size(): number {
    const role = this.getCouncilorRole()
    return role ? role.members.size : this.channel.members.size - 1
  }

  private getCouncilorRole() {
    return this.councilorRole
      ? this.channel.guild.roles.cache.get(this.councilorRole)
      : undefined
  }

  public get members(): Collection<Snowflake, GuildMember> {
    const role = this.getCouncilorRole()

    return role ? role.members : this.channel.members
  }

  public get currentMotion(): Motion | undefined {
    for (const [index, motion] of this.data.motions.entries()) {
      if (motion.active) {
        return new Motion(index, motion, this)
      }
    }
  }

  public get numMotions(): number {
    return this.data.motions.length
  }

  public getVoteWeights() {
    return this.getConfig("voteWeights") as
      | { [index: string]: number }
      | undefined
  }

  // TODO: Return object like {users: { id => weight}, total: number} and cache inside Motion
  public async calculateWeights(): Promise<CouncilWeights> {
    const weights = this.getVoteWeights()

    if (!weights) {
      return {
        total: this.size,
        users: {},
      }
    }

    const users: { [index: string]: number } = {}
    let total = 0

    await Promise.all(
      this.members.map(async (member) => {
        let userTotal = 0

        userTotal += weights[member.id] || 0

        Object.entries(weights).forEach(([roleId, roleWeight]) => {
          if (member.roles.cache.has(roleId)) {
            userTotal += roleWeight
          }
        })

        total += userTotal > 0 ? userTotal : 1 // minimum 1 vote

        if (userTotal > 0) users[member.id] = userTotal
      })
    )

    return {
      total,
      users,
    }
  }

  public isUserOnCooldown(id: Snowflake): boolean {
    if (!this.data.userCooldowns[id]) {
      return false
    }

    if (Date.now() - this.data.userCooldowns[id] < this.data.userCooldown) {
      return true
    }

    return false
  }

  public getUserCooldown(id: Snowflake): number {
    return this.userCooldown - (Date.now() - (this.data.userCooldowns[id] || 0))
  }

  public setUserCooldown(id: Snowflake, time: number = Date.now()): void {
    this.data.userCooldowns[id] = time
  }

  public getMotion(id: number): Motion {
    const motion = this.data.motions[id]

    if (motion == null) {
      throw new Error(`Motion ID ${id} for council ${this.id} does not exist.`)
    }

    return new Motion(id, motion, this)
  }

  public createMotion(data: MotionData): Motion {
    this.data.motions.push(data)

    return new Motion(this.data.motions.length - 1, data, this)
  }

  public exportData() {
    return JSON.stringify(this.data, undefined, "\t")
  }

  private loadData(useBackup?: boolean): void {
    let data: CouncilData
    try {
      const parsedSettings = JSON.parse(
        fs.readFileSync(this.dataPath + (useBackup ? ".bak" : ""), {
          encoding: "utf8",
        })
      )
      data = Object.assign(
        {},
        JSON.parse(JSON.stringify(Council.defaultData)),
        parsedSettings
      )
    } catch (e) {
      if (!useBackup) {
        return this.loadData(true)
      }

      data = JSON.parse(JSON.stringify(Council.defaultData))
    }

    this.data = onChange(data, () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(this.dataPath)) {
            fs.renameSync(this.dataPath, this.dataPath + ".bak")
          }
        } catch (e) {}

        fs.writeFile(
          this.dataPath,
          JSON.stringify(this.data, undefined, 2),
          () => undefined
        )
      }, 1)
    }) as CouncilData
  }
}
