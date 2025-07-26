# Requirements:
#
# sudo npm install -g @vscode/vsce

all: clean deps build

deps: clean
	@npm install
	@npm update

clean:
	@rm -rf node_modules/ *.vsix out/ package-lock.json meta.json

build:
	@vsce package
