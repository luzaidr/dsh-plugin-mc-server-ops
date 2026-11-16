scoreboard objectives add ic_timer dummy "物品清理计时器"
scoreboard players add icTimer ic_timer 1
execute if score icTimer ic_timer matches {{WARN_AT}} run function itemcleaner:warn
execute if score icTimer ic_timer matches {{CLEAN_AT}}.. run function itemcleaner:clean
