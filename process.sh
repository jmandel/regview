#!/bin/bash

source_pdf=$1
cache_dir=${1}.cache

mkdir -p $cache_dir
pdftk  $source_pdf burst  output ${cache_dir}/%04d.pdf
for t in ${cache_dir}/*.pdf; do  pdftotext  -raw $t; done
# convert ${cache_dir}/*.pdf ${cache_dir}/%03d.png
#convert ${cache_dir}/01*.pdf -background white -alpha remove -alpha off -trim -resize 512x512  ${cache_dir}/%03d.png
#convert ${cache_dir}/*.pdf -background white -alpha remove -alpha off ${cache_dir}/%03d.png
#convert ${cache_dir}/*.pdf -background white -alpha remove -alpha off -trim +repage ${cache_dir}/%03d.png

OUTPUT_FILE="$2"
> "$OUTPUT_FILE"
# Loop through all text files and concatenate them
for FILE in ${cache_dir}/*.txt; do
    cat "$FILE" >> "$OUTPUT_FILE"
    echo -e "\n" >> "$OUTPUT_FILE"
done

# Manually review and resolve any broken-up header lines
# In Vim, slash then \v\v^(\w\.).*\n[^A-Z0-9]