scoreboard players set icCnt ic_timer 0
execute as @e[type=minecraft:item] run scoreboard players add icCnt ic_timer 1
kill @e[type=minecraft:item]
execute if score icCnt ic_timer matches 1.. run tellraw @a ["",{"text":"[清理] ","color":"gold","bold":true},{"text":"已清理 ","color":"green"},{"score":{"name":"icCnt","objective":"ic_timer"},"color":"aqua","bold":true},{"text":" 个掉落物","color":"green"}]
scoreboard players set icTimer ic_timer 0
