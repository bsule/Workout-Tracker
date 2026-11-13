/** App-facing asynchronous API. All workout decisions execute in Rust. */
import type {Command} from './generated/commands'
import type {Query} from './generated/Query'
import type {Workout,WorkoutExercise,WorkoutSet,Exercise,ExerciseHistoryDay,UserSettings,Category,Gym,CalendarMap} from '../../core/src/types'
import {EngineClient} from './index'
export class WorkoutApi {
  private sequence=0
  constructor(readonly client:EngineClient,private prefix:string,private clock=()=>new Date()){}
  private command<T>(command:Command):Promise<T>{
    const now=this.clock();const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
    return this.client.execute<T>(`${this.prefix}:${++this.sequence}`,command,now.toISOString(),today).then(r=>r.result)
  }
  query<T>(query:Query):Promise<T>{return this.client.query<T>(query)}
  updateSettings(patch:Partial<UserSettings>){return this.command<UserSettings>({op:'update_settings',patch:{...patch}})}
  listExercises(params?:{category?:Category;q?:string;sort?:'name'|'last_performed'}){
    const today=this.clock();const date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-')
    return this.query<Exercise[]>({kind:'exercises',q:params?.q??null,category:params?.category??null,sort:params?.sort??'name',limit:500,today:date})
  }
  getExercise(id:number){return this.query<Exercise>({kind:'exercise',id})}
  createExercise(input:{name:string;category:Category;kind?:string}){return this.command<Exercise>({op:'create_exercise',...input,kind:input.kind??null})}
  patchExercise(id:number,patch:{name?:string;category?:Category}){return this.command<Exercise|null>({op:'patch_exercise',id,patch})}
  async deleteExercise(id:number){await this.command({op:'delete_exercise',id})}
  async createWorkout(date:string){const result=await this.command<{row:{id:number};merged_into_finished:boolean}>({op:'create_workout',date});return {...await this.getWorkout(result.row.id),merged_into_finished:result.merged_into_finished}}
  async getWorkout(id:number){const value=await this.query<Workout|null>({kind:'workout',id});if(!value)throw new Error('Workout not found');return value}
  getWorkoutByDate(date:string){return this.query<Workout|null>({kind:'workout_by_date',date})}
  async patchWorkout(id:number,patch:Partial<Pick<Workout,'notes'|'started_at'|'finished_at'|'gym'|'status'>>){await this.command({op:'patch_workout',id,patch});return this.getWorkout(id)}
  async deleteWorkout(id:number){await this.command({op:'delete_workout',id})}
  async addExerciseToWorkout(workoutId:number,exerciseId:number){const row=await this.command<{id:number}>({op:'add_exercise',workout_id:workoutId,exercise_id:exerciseId});const workout=await this.getWorkout(workoutId);const we=workout.exercises.find(e=>e.id===row.id);if(!we)throw new Error('Workout exercise not found');return we}
  async removeExerciseFromWorkout(_workoutId:number,weId:number){await this.command({op:'remove_exercise',we_id:weId})}
  private async setResult(weId:number,command:Command):Promise<WorkoutSet>{
    // Commands return the mutated row; query refresh supplies any historical
    // record flag changes to subscribed views.
    return this.command<WorkoutSet>(command)
  }
  addSet(weId:number,input:{weight?:number|null;reps?:number|null;distance_m?:number|null;time_seconds?:number|null;note?:string;created_at?:string}){return this.setResult(weId,{op:'add_set',we_id:weId,input})}
  addPlannedSet(weId:number,input:{weight?:number|null;reps?:number|null;distance_m?:number|null;time_seconds?:number|null;note?:string}){return this.setResult(weId,{op:'add_set',we_id:weId,input:{...input,is_planned:true}})}
  logSet(date:string,exerciseId:number,input:{weight?:number|null;reps?:number|null;note?:string;created_at?:string}){return this.command<{workout_id:number;we_id:number;set_id:number;set:WorkoutSet;merged_into_finished:boolean}>({op:'log_set',date,exercise_id:exerciseId,input})}
  updateSet(setId:number,patch:{weight?:number;reps?:number;note?:string;created_at?:string}){return this.command<WorkoutSet>({op:'update_set',set_id:setId,patch})}
  logPlannedSet(setId:number,patch:{weight?:number;reps?:number;note?:string;created_at?:string}){return this.command<WorkoutSet>({op:'log_planned_set',set_id:setId,patch})}
  async deleteSet(id:number){await this.deleteSets([id])}
  async deleteSets(ids:number[]){await this.command({op:'delete_sets',ids})}
  async copyFromWorkout(targetId:number,sourceId:number,withSets=false){await this.command({op:'copy_workout',target_id:targetId,source_id:sourceId,with_sets:withSets});return this.getWorkout(targetId)}
  setDayNote(date:string,text:string){return this.command<void>({op:'set_day_note',date,text})}
  setWorkoutNote(id:number,text:string){return this.patchWorkout(id,{notes:text.trim()})}
  setExerciseNote(weId:number,text:string){return this.command<void>({op:'set_exercise_note',we_id:weId,text})}
  listGyms(){return this.query<Gym[]>({kind:'gyms'})}
  createGym(name:string){return this.command<Gym>({op:'create_gym',name})}
  renameGym(id:number,name:string){return this.command<Gym|null>({op:'rename_gym',id,name})}
  async deleteGym(id:number){await this.command({op:'delete_gym',id})}
  getCalendar(year:number,month:number){return this.query<CalendarMap>({kind:'calendar',month:`${year}-${String(month).padStart(2,'0')}`})}
  getPlannedDates(year:number,month:number){return this.query<string[]>({kind:'planned_dates',month:`${year}-${String(month).padStart(2,'0')}`})}
  exerciseHistoryPage(id:number,offset=0,limit=30){return this.query<{total:number;items:ExerciseHistoryDay[]}>({kind:'history',exercise_id:id,offset,limit})}
  recomputePrs(){return this.command<{recomputed:number}>({op:'recompute_prs'})}
}
